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

interface ProbeOptions {
  port: number;
  timeoutMs: number;
  probe: Probe;
}

function foundAt(device: TailnetDevice, url: string, identity: Identity): FoundServer {
  return {
    instanceId: identity.instanceId,
    name: device.name,
    url,
    version: identity.version,
    webAccess: identity.webAccess,
  };
}

async function openableByIpv4(
  device: TailnetDevice,
  found: FoundServer,
  options: ProbeOptions,
): Promise<FoundServer | undefined> {
  const byIp = new URL(found.url);
  if (device.ipv4 === undefined || byIp.protocol !== "http:") return undefined;
  byIp.hostname = device.ipv4;
  const retry = await options.probe(byIp.origin, options.timeoutMs);
  if (
    retry.kind === "ours" &&
    retry.identity.instanceId === found.instanceId &&
    retry.identity.webAccess === "allowed"
  ) {
    return foundAt(device, byIp.origin, retry.identity);
  }
  return undefined;
}

export async function probeDevice(
  device: TailnetDevice,
  options: ProbeOptions,
): Promise<FoundServer | undefined> {
  let notOpenable: FoundServer | undefined;
  for (const origin of deviceOrigins(device.host, options.port)) {
    const result = await options.probe(origin, options.timeoutMs);
    if (result.kind !== "ours") continue;
    if (notOpenable !== undefined && result.identity.instanceId !== notOpenable.instanceId)
      continue;
    const found = foundAt(device, origin, result.identity);
    if (found.webAccess === "allowed") return found;
    const byIp = await openableByIpv4(device, found, options);
    if (byIp !== undefined) return byIp;
    notOpenable ??= found;
  }
  return notOpenable;
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
