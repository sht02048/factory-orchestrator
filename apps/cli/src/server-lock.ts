import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const SERVER_LOCK_FILE = "server.lock";
const BREAK_FILE = "server.lock.break";
const UNREADABLE_GRACE_MS = 2_000;
const START_TOLERANCE_MS = 2_000;

export const serverLockSchema = z.object({
  pid: z.number().int().positive(),
  url: z.string(),
  startedAt: z.string(),
});
export type ServerLock = z.infer<typeof serverLockSchema>;

export function serverLockPath(home: string): string {
  return join(home, SERVER_LOCK_FILE);
}

export class ServerAlreadyRunningError extends Error {
  readonly lock: ServerLock;

  constructor(lock: ServerLock) {
    super(`another start is already running for this home (pid ${lock.pid}, ${lock.url})`);
    this.name = "ServerAlreadyRunningError";
    this.lock = lock;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

export function processStartTime(pid: number): Date | undefined {
  try {
    const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const at = new Date(out);
    return out.length === 0 || Number.isNaN(at.getTime()) ? undefined : at;
  } catch {
    return undefined;
  }
}

export function isSameProcess(pid: number, since: Date): boolean {
  if (!isProcessAlive(pid)) return false;
  const started = processStartTime(pid);
  return started === undefined || started.getTime() <= since.getTime() + START_TOLERANCE_MS;
}

export function holdsLock(lock: ServerLock): boolean {
  const since = new Date(lock.startedAt);
  if (Number.isNaN(since.getTime())) return isProcessAlive(lock.pid);
  return isSameProcess(lock.pid, since);
}

export function readServerLock(home: string): ServerLock | undefined {
  let text: string;
  try {
    text = readFileSync(serverLockPath(home), "utf8");
  } catch {
    return undefined;
  }
  try {
    const parsed = serverLockSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function readLiveServerLock(
  home: string,
  holds: (lock: ServerLock) => boolean = holdsLock,
): ServerLock | undefined {
  const lock = readServerLock(home);
  return lock !== undefined && holds(lock) ? lock : undefined;
}

export interface HeldServerLock {
  lock: ServerLock;
  release(): void;
}

export function acquireServerLock(
  home: string,
  entry: Omit<ServerLock, "startedAt"> & { startedAt?: string },
  holds: (lock: ServerLock) => boolean = holdsLock,
): HeldServerLock {
  const lock: ServerLock = { ...entry, startedAt: entry.startedAt ?? new Date().toISOString() };
  const path = serverLockPath(home);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      writeFileSync(path, `${JSON.stringify(lock)}\n`, { flag: "wx", mode: 0o600 });
      let held = true;
      return {
        lock,
        release: () => {
          if (!held) return;
          held = false;
          if (readServerLock(home)?.pid === lock.pid) rmSync(path, { force: true });
        },
      };
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
    const current = readServerLock(home);
    if (current !== undefined && current.pid !== lock.pid && holds(current)) {
      throw new ServerAlreadyRunningError(current);
    }
    breakStaleLock(home, holds);
    sleepSync(50 * (attempt + 1));
  }
  const current = readServerLock(home);
  throw new ServerAlreadyRunningError(
    current ?? { pid: lock.pid, url: lock.url, startedAt: lock.startedAt },
  );
}

function breakStaleLock(home: string, holds: (lock: ServerLock) => boolean): void {
  const breaker = join(home, BREAK_FILE);
  try {
    writeFileSync(breaker, String(process.pid), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    if (ageMs(breaker) > UNREADABLE_GRACE_MS * 5) rmSync(breaker, { force: true });
    return;
  }
  try {
    const path = serverLockPath(home);
    const current = readServerLock(home);
    const stale = current === undefined ? ageMs(path) > UNREADABLE_GRACE_MS : !holds(current);
    if (stale) rmSync(path, { force: true });
  } finally {
    rmSync(breaker, { force: true });
  }
}

function ageMs(path: string): number {
  try {
    return Date.now() - statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
