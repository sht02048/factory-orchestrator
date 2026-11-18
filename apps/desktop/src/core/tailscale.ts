import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { z } from "zod";

/*
 * 이 기기에 로그인한 Tailscale 의 기기 목록을 CLI `status --json` 으로 읽는다(research 0013 2.1절). 추가 로그인
 * (API 키, OAuth, tsnet)은 쓰지 않는다. 출력은 Tailscale 의 공개 안정 계약이 아니라서 필요한 필드만 zod 로
 * 파싱하고, 실패하면 주소 입력으로 넘어가게 "unreadable" 을 돌려준다.
 */

/** 이 환경 변수에 CLI 경로를 주면 그것만 쓴다. 다른 곳에 설치한 경우와 시험에 쓴다 */
export const TAILSCALE_CLI_ENV = "FACTORY_TAILSCALE_CLI";

/**
 * macOS 에서 CLI 를 찾는 순서. GUI 앱은 로그인 셸의 PATH 를 물려받지 않아 알려진 위치를 직접 본다.
 * 독립형 앱의 CLI integration, Homebrew(Apple Silicon), App Store·독립형 앱 번들 안 실행 파일 순이다.
 */
export const TAILSCALE_CLI_CANDIDATES = [
  "/usr/local/bin/tailscale",
  "/opt/homebrew/bin/tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
] as const;

/** 서버는 macOS·Linux 에서만 돈다(ADR 0005). 휴대폰은 묻지 않는다 */
const PHONE_OS = new Set(["ios", "android"]);

const peerSchema = z.object({
  HostName: z.string().optional(),
  DNSName: z.string().optional(),
  OS: z.string().optional(),
  Online: z.boolean().optional(),
});

const statusSchema = z.object({
  BackendState: z.string(),
  Peer: z.record(z.string(), peerSchema).nullish(),
});

export interface TailnetDevice {
  /** 목록에 보일 이름. HostName, 없으면 DNSName 의 첫 부분 */
  name: string;
  /** 끝의 점을 뗀 MagicDNS 이름 */
  host: string;
}

export type TailnetStatus =
  | { kind: "missing" }
  /** Running 이 아니다(로그아웃, 꺼짐, NeedsLogin) */
  | { kind: "stopped" }
  /** CLI 가 실패했거나 출력 모양을 읽지 못했다 */
  | { kind: "unreadable" }
  | { kind: "running"; devices: TailnetDevice[] };

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
    // FQDN 끝의 점을 그대로 URL 에 넣으면 TLS 이름 검사가 어긋날 수 있다.
    const host = (peer.DNSName ?? "").replace(/\.$/, "");
    if (host.length === 0) continue;
    const hostName = peer.HostName?.trim() ?? "";
    devices.push({ name: hostName.length > 0 ? hostName : (host.split(".")[0] ?? host), host });
  }
  return { kind: "running", devices };
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
  // 앱 번들 안 실행 파일은 GUI 앱 본체이기도 해 인자 없이 부르지 않는다.
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
