export const WEBHOOK_PATH_PREFIX = "/api/webhooks/";
export const IDENTITY_PATH = "/api/identity";
export const WEBHOOK_PING_PREFIX = `${WEBHOOK_PATH_PREFIX}ping/`;

export const LOOPBACK_HOSTS: ReadonlyArray<string> = ["127.0.0.1", "localhost", "[::1]"];

const WILDCARD_BIND_HOSTS = new Set(["0.0.0.0", "[::]"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface AllowedHosts {
  web: ReadonlySet<string>;
  webhook: ReadonlySet<string>;
}

export interface AllowedHostsInput {
  bindHost: string | null;
  webAddress: string | null;
  webhookAddress: string | null;
}

export type RejectReason = "host-not-allowed" | "origin-not-allowed";

export type GuardVerdict =
  | { ok: true }
  | { ok: false; status: 403; reason: RejectReason; host: string; origin: string | null };

const HOST_HEADER = /^(\[[0-9a-f:.]+\]|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.?)(?::\d{1,5})?$/u;

export function normalizeHostname(hostname: string): string {
  const lower = hostname.trim().toLowerCase();
  const bare = lower.endsWith(".") ? lower.slice(0, -1) : lower;
  if (bare.includes(":") && !bare.startsWith("[")) return `[${bare}]`;
  return bare;
}

export function hostnameOfHostHeader(value: string | null): string | null {
  if (value === null) return null;
  const match = HOST_HEADER.exec(value.trim().toLowerCase());
  const hostname = match?.[1];
  return hostname === undefined ? null : normalizeHostname(hostname);
}

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

function isAnswerableOnAnyHost(pathname: string): boolean {
  return pathname === IDENTITY_PATH || pathname.startsWith(WEBHOOK_PING_PREFIX);
}

export function isWebhookPath(pathname: string): boolean {
  return pathname.startsWith(WEBHOOK_PATH_PREFIX);
}

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

export function checkRequest(request: Request, allowed: AllowedHosts): GuardVerdict {
  const { pathname } = new URL(request.url);
  const hostHeader = request.headers.get("host");
  const origin = request.headers.get("origin");
  const host = hostHeader ?? "";
  if (SAFE_METHODS.has(request.method) && isAnswerableOnAnyHost(pathname)) return { ok: true };
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

export function rejectionResponse(reason: RejectReason): Response {
  return new Response(`${REJECT_BODY[reason]}\n`, {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

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
