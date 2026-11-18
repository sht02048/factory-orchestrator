import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { homePaths, readBootEnv } from "@factory/cli/home";
import { isProcessAlive, readLiveServerLock } from "@factory/cli/server-lock";
import { webUrl } from "@factory/cli/web-url";
import { parseBootConfig } from "@factory/db";
import { z } from "zod";
import type { Identity, Probe } from "./identity.js";
import { probeIdentity } from "./identity.js";
import type { ServerBundle } from "./server-bundle.js";

/*
 * 이 기계의 서버(②)를 찾고, 띄우고, 멈춘다(티켓 0046).
 *
 * - ②는 앱의 자식이 아니다. 앱 실행 파일을 Node 로(ELECTRON_RUN_AS_NODE) 써서 서버 배포물의 CLI `start` 를
 *   새 세션(detached, 자기 프로세스 그룹)으로 띄우고 놓는다. 앱이 끝나거나 다시 떠도 ②는 계속 돈다.
 * - 도는 서버는 home 의 잠금 파일(`start` 가 쥔다, apps/cli/src/server-lock.ts)로 찾는다. 같은 home 에는 `start` 가
 *   하나만 뜬다. 잠금을 쥔 프로세스가 이 앱이 띄운 것(기록한 pid)이면 앱이 켜고 끄며, 아니면(③ 헤드리스 서비스,
 *   터미널의 `start`) 붙어서 상태만 본다.
 * - 앱이 띄운 ②의 서버 코드가 앱에 실린 배포물과 다르면(앱 업데이트) 옛 ②를 멈추고 새 ②를 띄운다. 옛 `start` 가
 *   끝나 잠금을 놓은 뒤에 새 `start` 를 띄우므로 worker 가 두 벌 돌지 않는다. 마이그레이션은 새 `start` 가 돌린다.
 */

/** 앱이 띄운 ②의 기록. 앱 데이터 폴더에 둔다 */
export const spawnRecordSchema = z.object({
  pid: z.number().int().positive(),
  buildId: z.string(),
  home: z.string(),
});
export type SpawnRecord = z.infer<typeof spawnRecordSchema>;

export interface RecordStore {
  read(): SpawnRecord | undefined;
  write(record: SpawnRecord | undefined): void;
}

export function fileRecordStore(path: string): RecordStore {
  return {
    read: () => {
      try {
        const parsed = spawnRecordSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
        return parsed.success ? parsed.data : undefined;
      } catch {
        return undefined;
      }
    },
    write: (record) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, record === undefined ? "{}\n" : `${JSON.stringify(record)}\n`);
    },
  };
}

/** app: 이 앱이 띄운 ②. external: ③이나 터미널에서 띄운 서버. 앱은 상태만 본다 */
export type Owner = "app" | "external";

export type LocalStatus =
  | { state: "stopped" }
  | { state: "starting"; owner: Owner; pid: number; url: string }
  | {
      state: "running";
      owner: Owner;
      /** 잠금 없이 포트로만 찾은 서버면 모른다 */
      pid: number | undefined;
      url: string;
      identity: Identity;
    };

export type EnsureResult =
  | {
      kind: "running";
      status: Extract<LocalStatus, { state: "running" }>;
      /** 앱에 실린 서버 코드로 옛 ②를 바꿨다 */
      replaced: boolean;
    }
  /** 이 home 에 헤드리스 서비스(③)가 등록돼 있지만 아직 돌지 않는다. 서비스 관리자가 띄우므로 ②를 띄우지 않는다 */
  | { kind: "service-not-running" }
  | { kind: "failed"; reason: string };

export type StopResult = { ok: true } | { ok: false; reason: "not-owned" };

export interface LocalServerOptions {
  home: string;
  bundle: Pick<ServerBundle, "cliEntry" | "buildId">;
  /** ②를 돌릴 Node. 앱은 자기 실행 파일과 ELECTRON_RUN_AS_NODE=1 을 준다 */
  node: { command: string; env: Readonly<Record<string, string | undefined>> };
  records: RecordStore;
  /** ②의 표준 출력·오류를 덧붙여 쓰는 파일 */
  logFile: string;
  /** 이 home 에 ③이 등록돼 있는가 */
  serviceInstalled?: () => boolean;
  probe?: Probe;
  isAlive?: (pid: number) => boolean;
  readyTimeoutMs?: number;
  stopTimeoutMs?: number;
  pollMs?: number;
}

export const READY_TIMEOUT_MS = 60_000;
/** `start` 는 자식을 15초 안에 멈추고 넘기면 SIGKILL 한다(apps/cli start.ts). 그보다 조금 길게 기다린다 */
export const STOP_TIMEOUT_MS = 20_000;

export class LocalServer {
  readonly home: string;
  private readonly options: LocalServerOptions;
  private readonly probe: Probe;
  private readonly isAlive: (pid: number) => boolean;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: LocalServerOptions) {
    this.options = options;
    this.home = options.home;
    this.probe = options.probe ?? ((origin, timeoutMs) => probeIdentity(origin, timeoutMs));
    this.isAlive = options.isAlive ?? isProcessAlive;
  }

  /** 지금 이 home 의 서버 상태. 아무것도 바꾸지 않는다 */
  async status(): Promise<LocalStatus> {
    const record = this.ownRecord();
    const lock = readLiveServerLock(this.home, this.isAlive);
    if (lock !== undefined) {
      const owner: Owner = record?.pid === lock.pid ? "app" : "external";
      const probed = await this.probe(lock.url, 1_000);
      if (probed.kind === "ours") {
        return { state: "running", owner, pid: lock.pid, url: lock.url, identity: probed.identity };
      }
      return { state: "starting", owner, pid: lock.pid, url: lock.url };
    }
    if (record !== undefined) {
      // 띄운 직후 잠금을 쥐기 전이다.
      if (this.isAlive(record.pid)) {
        return {
          state: "starting",
          owner: "app",
          pid: record.pid,
          url: this.configuredUrl() ?? "",
        };
      }
      // 앱이 띄운 `start` 가 SIGKILL 로 끝나 web·worker 만 남았다. 남은 web 이 포트에서 답해도 다른 서버로 보지 않고
      // 멈춘 것으로 본다. 다시 띄울 때(launch)와 멈출 때 그룹째 치운다.
      if (groupAlive(record.pid)) return { state: "stopped" };
    }
    // 잠금 없이 같은 포트에서 답하는 서버(잠금 파일을 쓰기 전 버전의 ③ 등)에도 붙는다. 두 벌을 띄우지 않는다.
    const url = this.configuredUrl();
    if (url !== undefined) {
      const probed = await this.probe(url, 1_000);
      if (probed.kind === "ours") {
        return {
          state: "running",
          owner: "external",
          pid: undefined,
          url,
          identity: probed.identity,
        };
      }
    }
    return { state: "stopped" };
  }

  /**
   * 도는 서버에 붙고, 없으면 ②를 띄운다. 앱이 띄운 ②가 다른 서버 코드면 바꾼다. ③에는 붙기만 한다.
   * 동시에 불러도(트레이, 감시) 차례로 돈다.
   */
  ensureRunning(): Promise<EnsureResult> {
    return this.serial(async () => {
      const current = await this.status();
      if (current.state !== "stopped") {
        if (current.owner === "app" && this.ownRecord()?.buildId !== this.options.bundle.buildId) {
          await this.stopOwned(current.pid);
          return this.launch(true);
        }
        if (current.state === "running")
          return { kind: "running", status: current, replaced: false };
        return this.waitReady(current.pid, false);
      }
      if (this.options.serviceInstalled?.() === true) return { kind: "service-not-running" };
      return this.launch(false);
    });
  }

  /** 앱이 띄운 ②만 멈춘다. ③은 서비스 관리자가 다시 띄우므로 멈추지 않는다 */
  stop(): Promise<StopResult> {
    return this.serial(async () => {
      const current = await this.status();
      if (current.state === "stopped") {
        const record = this.ownRecord();
        if (record !== undefined) await stopGroup(record.pid);
        this.options.records.write(undefined);
        return { ok: true };
      }
      if (current.owner !== "app" || current.pid === undefined)
        return { ok: false, reason: "not-owned" };
      await this.stopOwned(current.pid);
      return { ok: true };
    });
  }

  /** `init` 으로 부팅 설정을 만든다. 이미 있으면 그대로 둔다(암호화 키를 바꾸지 않는다) */
  initHome(): { ok: true } | { ok: false; reason: string } {
    if (existsSync(homePaths(this.home).envFile)) return { ok: true };
    const result = spawnSync(
      this.options.node.command,
      [this.options.bundle.cliEntry, "init", "--home", this.home],
      { env: { ...this.options.node.env }, encoding: "utf8" },
    );
    if (result.status === 0) return { ok: true };
    return { ok: false, reason: `${result.stdout}${result.stderr}`.trim() || "init failed" };
  }

  /** 부팅 설정의 web 주소. 설정이 없거나 틀리면 undefined */
  configuredUrl(): string | undefined {
    try {
      return webUrl(parseBootConfig(readBootEnv(homePaths(this.home).envFile, {})));
    } catch {
      return undefined;
    }
  }

  private ownRecord(): SpawnRecord | undefined {
    const record = this.options.records.read();
    return record?.home === this.home ? record : undefined;
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async launch(replaced: boolean): Promise<EnsureResult> {
    // 앞서 띄운 `start` 가 SIGKILL 로 끝났으면 그 web·worker 가 그룹에 남아 있다. 새 ②와 worker 가 두 벌 돌지 않게 먼저 치운다.
    const previous = this.ownRecord();
    if (previous !== undefined && !this.isAlive(previous.pid)) await stopGroup(previous.pid);
    const init = this.initHome();
    if (!init.ok) return { kind: "failed", reason: init.reason };
    mkdirSync(dirname(this.options.logFile), { recursive: true });
    const log = openSync(this.options.logFile, "a");
    let pid: number | undefined;
    try {
      const child = spawn(
        this.options.node.command,
        [this.options.bundle.cliEntry, "start", "--home", this.home],
        {
          // 새 세션·프로세스 그룹으로 띄워 앱과 함께 끝나지 않게 한다. web·worker 는 이 그룹에 든다.
          detached: true,
          stdio: ["ignore", log, log],
          env: { ...this.options.node.env },
        },
      );
      child.once("error", () => undefined);
      child.unref();
      pid = child.pid;
    } finally {
      closeSync(log);
    }
    if (pid === undefined) return { kind: "failed", reason: "could not spawn the server" };
    this.options.records.write({ pid, buildId: this.options.bundle.buildId, home: this.home });
    return this.waitReady(pid, replaced);
  }

  private async waitReady(pid: number, replaced: boolean): Promise<EnsureResult> {
    const deadline = Date.now() + (this.options.readyTimeoutMs ?? READY_TIMEOUT_MS);
    while (Date.now() < deadline) {
      const current = await this.status();
      if (current.state === "running") return { kind: "running", status: current, replaced };
      if (current.state === "stopped" || current.pid !== pid) {
        // 띄운 `start` 가 끝났다. 같은 home 에 다른 서버가 먼저 잠금을 쥐었으면 그쪽에 붙는다.
        if (!this.isAlive(pid)) {
          if (current.state === "starting") return this.waitReady(current.pid, replaced);
          return { kind: "failed", reason: `the server exited; see ${this.options.logFile}` };
        }
      }
      await sleep(this.options.pollMs ?? 200);
    }
    return { kind: "failed", reason: "the server did not respond in time" };
  }

  /** SIGTERM 으로 멈추고 끝나기를 기다린다. 넘기면 그룹째 SIGKILL 한다. 남은 web·worker(그룹)도 치운다 */
  private async stopOwned(pid: number | undefined): Promise<void> {
    if (pid === undefined) return;
    signal(pid, "SIGTERM");
    if (!(await this.waitGone(pid, this.options.stopTimeoutMs ?? STOP_TIMEOUT_MS))) {
      signal(-pid, "SIGKILL");
      await this.waitGone(pid, 5_000);
    }
    await stopGroup(pid);
    this.options.records.write(undefined);
  }

  private async waitGone(pid: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (this.isAlive(pid)) {
      if (Date.now() > deadline) return false;
      await sleep(100);
    }
    return true;
  }
}

function signal(pid: number, name: NodeJS.Signals): void {
  try {
    process.kill(pid, name);
  } catch {
    // 이미 끝났다.
  }
}

/** `start` 가 SIGKILL 로 끝나 남은 web·worker 를 멈춘다. 같은 프로세스 그룹(리더 = `start`)이라 그룹으로 보낸다 */
async function stopGroup(leader: number): Promise<void> {
  if (!groupAlive(leader)) return;
  signal(-leader, "SIGTERM");
  const deadline = Date.now() + 5_000;
  while (groupAlive(leader) && Date.now() < deadline) await sleep(100);
  if (groupAlive(leader)) signal(-leader, "SIGKILL");
}

/** 프로세스 그룹에 남은 프로세스가 있는가 */
function groupAlive(leader: number): boolean {
  try {
    process.kill(-leader, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
