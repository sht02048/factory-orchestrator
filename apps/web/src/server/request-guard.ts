/*
 * Host·Origin 검사(티켓 0048, Q9). 로그인이 없는 서버(Q3)라, 운영자 브라우저가 연 다른 사이트가 DNS 리바인딩이나
 * 교차 출처 요청으로 화면·server function 을 부르지 못하게 한다. 이 파일은 DB 를 들여오지 않는 순수 함수만 둔다.
 * 허용 목록을 만드는 일은 request-access.ts 가, 요청을 거르는 자리는 server-entry.ts 가 맡는다.
 *
 * - Host: 허용한 호스트로 온 요청만 받는다. 127.0.0.1·localhost·[::1] 은 늘 받아 설정을 잘못 넣어도 잠기지 않는다.
 *   바인드 주소(WEB_HOST)가 특정 주소면 그 주소도 받는다. 와일드카드(0.0.0.0, ::)는 호스트 이름이 아니라 넣지 않는다.
 * - Origin: 상태를 바꾸는 요청(GET·HEAD·OPTIONS 가 아닌 것, server function POST 포함)은 Origin 의 호스트도 허용
 *   목록에 있어야 한다. Origin 이 없으면 브라우저가 아닌 클라이언트(curl, CLI)라 받는다. 브라우저는 교차 출처 POST 에
 *   Origin 을 늘 붙인다. `null` Origin(샌드박스 iframe, file://)은 받지 않는다.
 * - webhook 경로는 Origin 을 보지 않는다(서명으로 검증, ticket 0040). Host 는 webhook 공개 주소의 호스트도 받는다.
 * - 신원 확인 경로는 Host 를 보지 않는다. 다른 기기가 tailnet 주소로 물어도 "우리 서버인지"는 답한다(identity.ts).
 * 포트는 비교하지 않는다. 리버스 프록시·Tailscale Serve 가 포트를 바꿔 넘기기 때문이다.
 */

export const WEBHOOK_PATH_PREFIX = "/api/webhooks/";
export const IDENTITY_PATH = "/api/identity";

/** 설정과 상관없이 늘 받는 호스트 */
export const LOOPBACK_HOSTS: ReadonlyArray<string> = ["127.0.0.1", "localhost", "[::1]"];

const WILDCARD_BIND_HOSTS = new Set(["0.0.0.0", "[::]"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface AllowedHosts {
  /** 화면·server function 을 받는 호스트 */
  web: ReadonlySet<string>;
  /** webhook 경로에서 더 받는 호스트(webhook 공개 주소) */
  webhook: ReadonlySet<string>;
}

export interface AllowedHostsInput {
  /** 부팅 설정의 바인드 주소(WEB_HOST). 읽지 못하면 null */
  bindHost: string | null;
  webAddress: string | null;
  webhookAddress: string | null;
}

export type RejectReason = "host-not-allowed" | "origin-not-allowed";

export type GuardVerdict =
  | { ok: true }
  | { ok: false; status: 403; reason: RejectReason; host: string; origin: string | null };

const HOST_HEADER = /^(\[[0-9a-f:.]+\]|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.?)(?::\d{1,5})?$/u;

/** 호스트 이름을 비교할 모양으로 바꾼다. 소문자, 끝의 점을 뗀다. IPv6 는 대괄호로 감싼다 */
export function normalizeHostname(hostname: string): string {
  const lower = hostname.trim().toLowerCase();
  const bare = lower.endsWith(".") ? lower.slice(0, -1) : lower;
  if (bare.includes(":") && !bare.startsWith("[")) return `[${bare}]`;
  return bare;
}

/**
 * Host 헤더에서 호스트 이름을 꺼낸다. 브라우저가 보내지 않는 모양(사용자 정보 `@`, 경로, 빈 값)은 null 이다.
 * `new URL` 로 풀면 `evil.example@127.0.0.1` 이 127.0.0.1 로 읽혀 쓰지 않는다.
 */
export function hostnameOfHostHeader(value: string | null): string | null {
  if (value === null) return null;
  const match = HOST_HEADER.exec(value.trim().toLowerCase());
  const hostname = match?.[1];
  return hostname === undefined ? null : normalizeHostname(hostname);
}

/** 저장한 주소(origin)의 호스트 이름. 읽지 못하면 null */
function hostnameOfAddress(address: string | null): string | null {
  if (address === null) return null;
  try {
    return normalizeHostname(new URL(address).hostname);
  } catch {
    return null;
  }
}

export function allowedHosts(input: AllowedHostsInput): AllowedHosts {
  const web = new Set(LOOPBACK_HOSTS);
  if (input.bindHost !== null) {
    const bind = normalizeHostname(input.bindHost);
    if (!WILDCARD_BIND_HOSTS.has(bind)) web.add(bind);
  }
  const webHost = hostnameOfAddress(input.webAddress);
  if (webHost !== null) web.add(webHost);
  const webhook = new Set<string>();
  const webhookHost = hostnameOfAddress(input.webhookAddress);
  if (webhookHost !== null) webhook.add(webhookHost);
  return { web, webhook };
}

export function isWebhookPath(pathname: string): boolean {
  return pathname.startsWith(WEBHOOK_PATH_PREFIX);
}

/** 이 경로에서 요청의 Host 를 받는지 */
export function isHostAllowed(
  hostname: string | null,
  pathname: string,
  allowed: AllowedHosts,
): boolean {
  if (hostname === null) return false;
  if (allowed.web.has(hostname)) return true;
  return isWebhookPath(pathname) && allowed.webhook.has(hostname);
}

function originAllowed(origin: string, allowed: AllowedHosts): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return allowed.web.has(normalizeHostname(url.hostname));
  } catch {
    return false;
  }
}

/** 요청을 받을지 정한다. 거절이면 상태 코드와 까닭을 담는다 */
export function checkRequest(request: Request, allowed: AllowedHosts): GuardVerdict {
  const { pathname } = new URL(request.url);
  const hostHeader = request.headers.get("host");
  const origin = request.headers.get("origin");
  const host = hostHeader ?? "";
  if (pathname === IDENTITY_PATH && SAFE_METHODS.has(request.method)) return { ok: true };
  if (!isHostAllowed(hostnameOfHostHeader(hostHeader), pathname, allowed)) {
    return { ok: false, status: 403, reason: "host-not-allowed", host, origin };
  }
  if (SAFE_METHODS.has(request.method) || isWebhookPath(pathname) || origin === null) {
    return { ok: true };
  }
  if (!originAllowed(origin, allowed)) {
    return { ok: false, status: 403, reason: "origin-not-allowed", host, origin };
  }
  return { ok: true };
}

const REJECT_BODY: Record<RejectReason, string> = {
  "host-not-allowed":
    "Blocked request: this server does not accept the host name you used. " +
    "Open it from the server machine at http://127.0.0.1, then add the address you use " +
    "under Settings > Addresses.",
  "origin-not-allowed":
    "Blocked request: a page from another site tried to change this server. " +
    "Open the server at an allowed address and try again.",
};

/** 거절 응답. 사용자가 브라우저에서 보는 글이라 영어로 쓴다(ADR 0005) */
export function rejectionResponse(reason: RejectReason): Response {
  return new Response(`${REJECT_BODY[reason]}\n`, {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

/** 로그 한 줄. 값은 공격자가 정할 수 있어 길이를 줄이고 따옴표로 감싼다 */
export function rejectionLogLine(
  request: Request,
  verdict: Extract<GuardVerdict, { ok: false }>,
): string {
  const clip = (value: string) => JSON.stringify(value.slice(0, 200));
  const { pathname } = new URL(request.url);
  return (
    `request rejected: ${verdict.status} ${verdict.reason} ${request.method} ${clip(pathname)} ` +
    `host=${clip(verdict.host)} origin=${verdict.origin === null ? "-" : clip(verdict.origin)}`
  );
}
