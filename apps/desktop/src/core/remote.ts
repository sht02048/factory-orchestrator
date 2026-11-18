import type { DiscoveryResult, FoundServer } from "./discovery.js";
import type { Probe } from "./identity.js";

/*
 * 원격 모드 연결(research 0013 4절 흐름). (a) 넣은 주소가 우리 서버인지 확인해 저장하고, 다음 실행에서 저장한
 * 서버를 바로 연다. 닿지 않으면 같은 instanceId 를 tailnet 에서 다시 찾고, 그래도 없으면 "닿지 않음" 이다.
 */

/** 앱 설정에 저장하는 서버 */
export interface SavedServer {
  instanceId: string;
  name: string;
  url: string;
}

export type ConnectFailure =
  /** 주소 모양이 틀렸다 */
  | "invalid"
  | "unreachable"
  /** 응답은 왔지만 우리 서버가 아니다 */
  | "not-ours"
  /** 우리 서버지만 이 주소로는 화면을 열 수 없다(그 서버의 Settings > 주소에서 정한다) */
  | "host-not-allowed";

export type ConnectResult =
  | { ok: true; server: SavedServer }
  | { ok: false; reason: ConnectFailure };

export const CONNECT_TIMEOUT_MS = 3_000;

/**
 * 사람이 넣은 주소를 origin 으로 바꾼다. scheme 이 없으면 포트가 있을 때 http, 없을 때 https(Tailscale Serve)로 본다.
 * 경로·쿼리는 버린다. 앱 창은 그 서버의 첫 화면을 연다.
 */
export function normalizeAddress(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed.length === 0) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `${/^[^/]+:\d+(\/|$)/.test(trimmed) ? "http" : "https"}://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (url.hostname.length === 0 || url.username !== "" || url.password !== "") return undefined;
  return url.origin;
}

/** 주소로 연결한다. 우리 서버이고 화면을 열 수 있을 때만 저장할 서버를 돌려준다 */
export async function connectAddress(
  input: string,
  probe: Probe,
  timeoutMs: number = CONNECT_TIMEOUT_MS,
): Promise<ConnectResult> {
  const origin = normalizeAddress(input);
  if (origin === undefined) return { ok: false, reason: "invalid" };
  const result = await probe(origin, timeoutMs);
  switch (result.kind) {
    case "unreachable":
    case "not-ours":
      return { ok: false, reason: result.kind };
    case "ours":
      if (result.identity.webAccess !== "allowed") return { ok: false, reason: "host-not-allowed" };
      return {
        ok: true,
        server: {
          instanceId: result.identity.instanceId,
          name: new URL(origin).hostname,
          url: origin,
        },
      };
  }
}

/** 찾은 서버 목록에서 고른 서버. 목록에 보인 기기 이름을 저장한다 */
export function savedFromFound(server: FoundServer): SavedServer {
  return { instanceId: server.instanceId, name: server.name, url: server.url };
}

export type ReopenResult =
  | { kind: "open"; server: SavedServer }
  /** 저장한 주소로도, tailnet 에서도 그 서버를 찾지 못했다 */
  | { kind: "unreachable" };

/**
 * 저장한 서버를 다시 연다. 저장한 주소가 같은 서버(instanceId)로 답하면 연다. 아니면 tailnet 에서 같은 instanceId 를
 * 찾아 주소가 바뀌었으면 새 주소로 연다.
 */
export async function reopenSaved(
  saved: SavedServer,
  deps: { probe: Probe; discover: () => Promise<DiscoveryResult>; timeoutMs?: number },
): Promise<ReopenResult> {
  const result = await deps.probe(saved.url, deps.timeoutMs ?? CONNECT_TIMEOUT_MS);
  if (
    result.kind === "ours" &&
    result.identity.instanceId === saved.instanceId &&
    result.identity.webAccess === "allowed"
  ) {
    return { kind: "open", server: saved };
  }
  const found = await deps.discover();
  if (found.kind === "found") {
    const same = found.servers.find(
      (server) => server.instanceId === saved.instanceId && server.webAccess === "allowed",
    );
    if (same !== undefined) return { kind: "open", server: { ...saved, url: same.url } };
  }
  return { kind: "unreachable" };
}
