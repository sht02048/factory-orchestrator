import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { z } from "zod";

export const TAILSCALE_CLI_ENV = "GANGER_TAILSCALE_CLI";

export const TAILSCALE_CLI_CANDIDATES = [
  "/usr/local/bin/tailscale",
  "/opt/homebrew/bin/tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
] as const;

const PHONE_OS = new Set(["ios", "android"]);
const ipv4Schema = z.ipv4().refine((ip) => URL.parse(`http://${ip}`)?.hostname === ip);

function isTailnetIpv4(ip: unknown): ip is string {
  return ipv4Schema.safeParse(ip).success;
}

const peerSchema = z.object({
  HostName: z.string().optional(),
  DNSName: z.string().optional(),
  OS: z.string().optional(),
  Online: z.boolean().optional(),
  TailscaleIPs: z.array(z.unknown()).nullish().catch(undefined),
});

const selfSchema = z.object({ DNSName: z.string().optional() });

const statusSchema = z.object({
  BackendState: z.string(),
  Self: selfSchema.nullish().catch(null),
  Peer: z.record(z.string(), peerSchema).nullish(),
});

export interface TailnetDevice {
  name: string;
  host: string;
  ipv4?: string;
}

export type TailnetStatus =
  | { kind: "missing" }
  | { kind: "stopped" }
  | { kind: "unreadable" }
  | { kind: "running"; self: string | null; devices: TailnetDevice[] };

function hostOfDnsName(dnsName: string | undefined): string | null {
  const host = (dnsName ?? "").trim().replace(/\.$/, "").toLowerCase();
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/u.test(host) ? host : null;
}

export function parseTailnetStatus(output: string): TailnetStatus {
  let json: unknown;
  try {
    json = JSON.parse(output);
  } catch {
    return { kind: "unreadable" };
  }
  const parsed = statusSchema.safeParse(json);
  if (!parsed.success) return { kind: "unreadable" };
  if (parsed.data.BackendState !== "Running") return { kind: "stopped" };
  const devices: TailnetDevice[] = [];
  for (const peer of Object.values(parsed.data.Peer ?? {})) {
    if (peer.Online !== true) continue;
    if (PHONE_OS.has((peer.OS ?? "").toLowerCase())) continue;
    const host = (peer.DNSName ?? "").replace(/\.$/, "");
    if (host.length === 0) continue;
    const hostName = peer.HostName?.trim() ?? "";
    const ipv4 = peer.TailscaleIPs?.find(isTailnetIpv4);
    devices.push({
      name: hostName.length > 0 ? hostName : (host.split(".")[0] ?? host),
      host,
      ...(ipv4 === undefined ? {} : { ipv4 }),
    });
  }
  return { kind: "running", self: hostOfDnsName(parsed.data.Self?.DNSName), devices };
}

export interface TailnetDeps {
  env: Readonly<Record<string, string | undefined>>;
  exists(path: string): boolean;
  run(file: string, args: ReadonlyArray<string>, timeoutMs: number): Promise<string | undefined>;
}

export function findTailscaleCli(deps: Pick<TailnetDeps, "env" | "exists">): string | undefined {
  const override = deps.env[TAILSCALE_CLI_ENV]?.trim();
  if (override !== undefined && override.length > 0) {
    return deps.exists(override) ? override : undefined;
  }
  return TAILSCALE_CLI_CANDIDATES.find((path) => deps.exists(path));
}

export async function readTailnet(deps: TailnetDeps = defaultTailnetDeps): Promise<TailnetStatus> {
  const cli = findTailscaleCli(deps);
  if (cli === undefined) return { kind: "missing" };
  const output = await deps.run(cli, ["status", "--json"], 3_000);
  if (output === undefined) return { kind: "unreadable" };
  return parseTailnetStatus(output);
}

export const defaultTailnetDeps: TailnetDeps = {
  env: process.env,
  exists: existsSync,
  run: (file, args, timeoutMs) =>
    new Promise((resolve) => {
      execFile(
        file,
        [...args],
        { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, encoding: "utf8" },
        (error, stdout) => resolve(error === null ? stdout : undefined),
      );
    }),
};

export interface ThisTailnetDevice {
  cli: string;
  host: string;
}

export async function readThisTailnetDevice(
  deps: TailnetDeps = defaultTailnetDeps,
): Promise<ThisTailnetDevice | null> {
  const cli = findTailscaleCli(deps);
  if (cli === undefined) return null;
  const output = await deps.run(cli, ["status", "--json"], 3_000);
  if (output === undefined) return null;
  const status = parseTailnetStatus(output);
  if (status.kind !== "running" || status.self === null) return null;
  return { cli, host: status.self };
}
