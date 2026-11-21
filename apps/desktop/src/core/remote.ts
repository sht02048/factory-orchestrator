import type { DiscoveryResult, FoundServer } from "./discovery.js";
import type { Probe } from "./identity.js";

export interface SavedServer {
  instanceId: string;
  name: string;
  url: string;
}

export type ConnectFailure = "invalid" | "unreachable" | "not-ours" | "host-not-allowed";

export type ConnectResult =
  | { ok: true; server: SavedServer }
  | { ok: false; reason: ConnectFailure };

export const CONNECT_TIMEOUT_MS = 3_000;

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

export function savedFromFound(server: FoundServer): SavedServer {
  return { instanceId: server.instanceId, name: server.name, url: server.url };
}

export type ReopenResult =
  | { kind: "open"; server: SavedServer }
  | { kind: "host-not-allowed" }
  | { kind: "unreachable" };

export function isServerForbidden(
  httpResponseCode: number,
  url: string,
  serverUrl: string | undefined,
): boolean {
  if (httpResponseCode !== 403 || serverUrl === undefined) return false;
  const page = URL.parse(url);
  const server = URL.parse(serverUrl);
  return page !== null && server !== null && page.origin === server.origin;
}

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
  const blocked =
    result.kind === "ours" &&
    result.identity.instanceId === saved.instanceId &&
    result.identity.webAccess !== "allowed";
  return blocked ? { kind: "host-not-allowed" } : { kind: "unreachable" };
}
