import type { Identity, Probe } from "./identity.js";
import { probeIdentity } from "./identity.js";
import type { TailnetDevice, TailnetStatus } from "./tailscale.js";
import { readTailnet } from "./tailscale.js";

export const DEFAULT_SERVER_PORT = 3000;
export const PROBE_TIMEOUT_MS = 1_000;

export interface FoundServer {
  instanceId: string;
  name: string;
  url: string;
  version: string;
  webAccess: Identity["webAccess"];
}

export type DiscoveryResult =
  | { kind: "missing" }
  | { kind: "stopped" }
  | { kind: "unreadable" }
  | { kind: "found"; servers: FoundServer[] };

export function deviceOrigins(host: string, port: number): string[] {
  return [`http://${host}:${port}`, `https://${host}`];
}

export async function probeDevice(
  device: TailnetDevice,
  options: { port: number; timeoutMs: number; probe: Probe },
): Promise<FoundServer | undefined> {
  for (const origin of deviceOrigins(device.host, options.port)) {
    const result = await options.probe(origin, options.timeoutMs);
    if (result.kind !== "ours") continue;
    const found: FoundServer = {
      instanceId: result.identity.instanceId,
      name: device.name,
      url: origin,
      version: result.identity.version,
      webAccess: result.identity.webAccess,
    };
    const byIp = new URL(origin);
    if (found.webAccess === "allowed" || device.ipv4 === undefined || byIp.protocol !== "http:") {
      return found;
    }
    byIp.hostname = device.ipv4;
    const retry = await options.probe(byIp.origin, options.timeoutMs);
    if (
      retry.kind === "ours" &&
      retry.identity.instanceId === found.instanceId &&
      retry.identity.webAccess === "allowed"
    ) {
      return { ...found, url: byIp.origin, version: retry.identity.version, webAccess: "allowed" };
    }
    return found;
  }
  return undefined;
}

export interface DiscoveryOptions {
  port?: number;
  timeoutMs?: number;
  probe?: Probe;
  tailnet?: () => Promise<TailnetStatus>;
}

export async function discoverServers(options: DiscoveryOptions = {}): Promise<DiscoveryResult> {
  const status = await (options.tailnet ?? (() => readTailnet()))();
  if (status.kind !== "running") return status;
  const probe = options.probe ?? ((origin, timeoutMs) => probeIdentity(origin, timeoutMs));
  const found = await Promise.all(
    status.devices.map((device) =>
      probeDevice(device, {
        port: options.port ?? DEFAULT_SERVER_PORT,
        timeoutMs: options.timeoutMs ?? PROBE_TIMEOUT_MS,
        probe,
      }),
    ),
  );
  const servers: FoundServer[] = [];
  const seen = new Set<string>();
  for (const server of found) {
    if (server === undefined || seen.has(server.instanceId)) continue;
    seen.add(server.instanceId);
    servers.push(server);
  }
  servers.sort((a, b) => a.name.localeCompare(b.name));
  return { kind: "found", servers };
}
