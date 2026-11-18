import type { Identity, Probe } from "./identity.js";
import { probeIdentity } from "./identity.js";
import type { TailnetDevice, TailnetStatus } from "./tailscale.js";
import { readTailnet } from "./tailscale.js";

/*
 * tailnet 기기 가운데 우리 서버가 도는 기기를 찾는다(Q13, research 0013 2.1절). Online 기기마다
 * `http://<기기>:3000/api/identity` 를 먼저, 그다음 `https://<기기>/api/identity`(Tailscale Serve, 443)를 묻고,
 * 처음 우리 서버라고 답한 주소를 쓴다. 기기마다 주소 하나당 1초를 기다리고, 기기끼리는 동시에 묻는다.
 */

export const DEFAULT_SERVER_PORT = 3000;
export const PROBE_TIMEOUT_MS = 1_000;

export interface FoundServer {
  instanceId: string;
  /** 기기 이름(HostName) */
  name: string;
  /** 붙을 주소(origin) */
  url: string;
  version: string;
  webAccess: Identity["webAccess"];
}

export type DiscoveryResult =
  | { kind: "missing" }
  | { kind: "stopped" }
  | { kind: "unreadable" }
  /** servers 가 비면 "찾지 못함" 이다 */
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
    if (result.kind === "ours") {
      return {
        instanceId: result.identity.instanceId,
        name: device.name,
        url: origin,
        version: result.identity.version,
        webAccess: result.identity.webAccess,
      };
    }
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
  // 같은 서버가 여러 기기 이름으로 보이면(같은 instanceId) 하나만 둔다.
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
