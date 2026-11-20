import { execFileSync, spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { homePaths, readBootEnv } from "@ganger/cli/home";
import { isProcessAlive, isSameProcess, readLiveServerLock } from "@ganger/cli/server-lock";
import { webUrl } from "@ganger/cli/web-url";
import { parseBootConfig } from "@ganger/db";
import { log, readLogSettings, rotateIfOver } from "@ganger/log";
import { z } from "zod";
import type { Identity, Probe } from "./identity.js";
import { probeIdentity } from "./identity.js";
import type { ServerBundle } from "./server-bundle.js";

export const spawnRecordSchema = z.object({
  pid: z.number().int().positive(),
  buildId: z.string(),
  home: z.string(),
  spawnedAt: z.string(),
  root: z.string(),
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

export function rotateOutputLog(
  logFile: string,
  env: Readonly<Record<string, string | undefined>>,
): void {
  try {
    rotateIfOver(logFile, readLogSettings(env).limits);
  } catch (error) {
    log().warn("log.rotate_failed", { path: basename(logFile), error });
  }
}

export type Owner = "app" | "external";

export type LocalStatus =
  | { state: "stopped" }
  | { state: "starting"; owner: Owner; pid: number; url: string }
  | {
      state: "running";
      owner: Owner;
      pid: number | undefined;
      url: string;
      identity: Identity;
    };

export type EnsureResult =
  | {
      kind: "running";
      status: Extract<LocalStatus, { state: "running" }>;
      replaced: boolean;
    }
  | { kind: "service-not-running" }
  | { kind: "failed"; reason: string };

export interface Replacement {
  from: string | null;
  to: string | null;
}

export interface EnsureHooks {
  onReplacing?: (replacement: Replacement) => void;
}

export function versionOfBuild(buildId: string | undefined): string | null {
  if (buildId === undefined) return null;
  const version = buildId.split("+")[0] ?? "";
  return version.length > 0 ? version : null;
}

export type StopResult = { ok: true } | { ok: false; reason: "not-owned" };

export interface LocalServerOptions {
  home: string;
  bundle: Pick<ServerBundle, "cliEntry" | "buildId">;
  node: { command: string; env: Readonly<Record<string, string | undefined>> };
  records: RecordStore;
  logFile: string;
  bundleRoot?: string;
  serviceInstalled?: () => boolean;
  probe?: Probe;
  readyTimeoutMs?: number;
  stopTimeoutMs?: number;
  pollMs?: number;
}

export const READY_TIMEOUT_MS = 60_000;
export const STOP_TIMEOUT_MS = 20_000;

export class LocalServer {
  readonly home: string;
  private readonly options: LocalServerOptions;
  private readonly probe: Probe;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: LocalServerOptions) {
    this.options = options;
    this.home = options.home;
    this.probe = options.probe ?? ((origin, timeoutMs) => probeIdentity(origin, timeoutMs));
  }

  async status(): Promise<LocalStatus> {
    const record = this.ownRecord();
    const lock = readLiveServerLock(this.home);
    if (lock !== undefined) {
      const owner: Owner =
        record !== undefined && record.pid === lock.pid && recordAlive(record) ? "app" : "external";
      const probed = await this.probe(lock.url, 1_000);
      if (probed.kind === "ours") {
        return { state: "running", owner, pid: lock.pid, url: lock.url, identity: probed.identity };
      }
      return { state: "starting", owner, pid: lock.pid, url: lock.url };
    }
    if (record !== undefined) {
      if (recordAlive(record)) {
        return {
          state: "starting",
          owner: "app",
          pid: record.pid,
          url: this.configuredUrl() ?? "",
        };
      }
      if (leftovers(record).length > 0) return { state: "stopped" };
    }
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

  ensureRunning(hooks: EnsureHooks = {}): Promise<EnsureResult> {
    return this.serial(async () => {
      const current = await this.status();
      if (current.state !== "stopped") {
        const record = this.ownRecord();
        if (current.owner === "app" && record?.buildId !== this.options.bundle.buildId) {
          hooks.onReplacing?.({
            from: versionOfBuild(record?.buildId),
            to: versionOfBuild(this.options.bundle.buildId),
          });
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

  stop(): Promise<StopResult> {
    return this.serial(async () => {
      const current = await this.status();
      if (current.state === "stopped") {
        const record = this.ownRecord();
        if (record !== undefined) await stopLeftovers(record);
        this.options.records.write(undefined);
        return { ok: true };
      }
      if (current.owner !== "app" || current.pid === undefined)
        return { ok: false, reason: "not-owned" };
      await this.stopOwned(current.pid);
      return { ok: true };
    });
  }

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
    const previous = this.ownRecord();
    if (previous !== undefined && !recordAlive(previous)) await stopLeftovers(previous);
    const init = this.initHome();
    if (!init.ok) return { kind: "failed", reason: init.reason };
    mkdirSync(dirname(this.options.logFile), { recursive: true });
    rotateOutputLog(this.options.logFile, this.options.node.env);
    const log = openSync(this.options.logFile, "a");
    let pid: number | undefined;
    try {
      const child = spawn(
        this.options.node.command,
        [this.options.bundle.cliEntry, "start", "--home", this.home],
        {
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
    this.options.records.write({
      pid,
      buildId: this.options.bundle.buildId,
      home: this.home,
      spawnedAt: new Date().toISOString(),
      root: this.options.bundleRoot ?? dirname(dirname(dirname(this.options.bundle.cliEntry))),
    });
    return this.waitReady(pid, replaced);
  }

  private async waitReady(pid: number, replaced: boolean): Promise<EnsureResult> {
    const deadline = Date.now() + (this.options.readyTimeoutMs ?? READY_TIMEOUT_MS);
    while (Date.now() < deadline) {
      const current = await this.status();
      if (current.state === "running") return { kind: "running", status: current, replaced };
      if (current.state === "stopped" || current.pid !== pid) {
        if (!isProcessAlive(pid)) {
          if (current.state === "starting") return this.waitReady(current.pid, replaced);
          return { kind: "failed", reason: `the server exited; see ${this.options.logFile}` };
        }
      }
      await sleep(this.options.pollMs ?? 200);
    }
    return { kind: "failed", reason: "the server did not respond in time" };
  }

  private async stopOwned(pid: number | undefined): Promise<void> {
    if (pid === undefined) return;
    signal(pid, "SIGTERM");
    if (!(await this.waitGone(pid, this.options.stopTimeoutMs ?? STOP_TIMEOUT_MS))) {
      signal(-pid, "SIGKILL");
      await this.waitGone(pid, 5_000);
    }
    const record = this.ownRecord();
    if (record !== undefined) await stopLeftovers(record);
    this.options.records.write(undefined);
  }

  private async waitGone(pid: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (isProcessAlive(pid)) {
      if (Date.now() > deadline) return false;
      await sleep(100);
    }
    return true;
  }
}

function signal(pid: number, name: NodeJS.Signals): void {
  try {
    process.kill(pid, name);
  } catch {}
}

function recordAlive(record: SpawnRecord): boolean {
  const since = new Date(record.spawnedAt);
  return Number.isNaN(since.getTime()) ? false : isSameProcess(record.pid, since);
}

function leftovers(record: SpawnRecord): number[] {
  let out: string;
  try {
    out = execFileSync("ps", ["-axo", "pid=,pgid=,command="], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return [];
  }
  return out.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (match === null) return [];
    const [, pid, pgid, command] = match;
    if (Number(pgid) !== record.pid || command === undefined || !command.includes(record.root))
      return [];
    return [Number(pid)];
  });
}

async function stopLeftovers(record: SpawnRecord): Promise<void> {
  const send = (name: NodeJS.Signals) => {
    for (const pid of leftovers(record)) signal(pid, name);
  };
  if (leftovers(record).length === 0) return;
  send("SIGTERM");
  const deadline = Date.now() + 5_000;
  while (leftovers(record).length > 0 && Date.now() < deadline) await sleep(100);
  send("SIGKILL");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
