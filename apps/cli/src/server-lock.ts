import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/*
 * 서버 잠금 파일(티켓 0046). `start`가 home 에 web·worker 를 띄우는 동안 `<home>/server.lock` 을 쥔다.
 * 같은 home 에 `start` 가 두 벌 뜨지 않게 막고(데스크톱 앱의 ②와 헤드리스 서비스 ③이 같은 코드를 쓴다),
 * 데스크톱 앱이 도는 서버를 찾아 붙을 때 읽는다. 모양을 바꾸면 apps/desktop 도 함께 바꾼다.
 *
 * 파일이 남아 있어도 적힌 프로세스가 없거나, 그 pid 가 잠금을 쓴 뒤에 시작한 다른 프로세스면(재부팅 뒤 pid 재사용)
 * 낡은 잠금으로 보고 새로 쥔다.
 */

export const SERVER_LOCK_FILE = "server.lock";
/** 낡은 잠금을 치우는 동안만 쥐는 파일. 두 `start` 가 같은 낡은 잠금을 함께 치우지 않게 한다 */
const BREAK_FILE = "server.lock.break";
/** 막 만든 잠금은 내용을 쓰기 전에 읽힐 수 있다. 이보다 오래된 읽을 수 없는 잠금만 낡은 것으로 본다 */
const UNREADABLE_GRACE_MS = 2_000;
/** 잠금을 쓴 시각과 프로세스가 시작한 시각의 허용 오차(ps 의 시작 시각은 초 단위다) */
const START_TOLERANCE_MS = 2_000;

export const serverLockSchema = z.object({
  /** 잠금을 쥔 `start` 프로세스 */
  pid: z.number().int().positive(),
  /** web 에 닿는 주소(start 의 webUrl) */
  url: z.string(),
  /** ISO 8601. 잠금을 쓴 시각 */
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

/** 프로세스가 살아 있는가. 신호는 보내지 않고 권한·존재만 본다. 다른 계정의 프로세스(EPERM)도 살아 있다 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

/** 프로세스가 시작한 시각(초 단위). 프로세스가 없거나 읽지 못하면 undefined */
export function processStartTime(pid: number): Date | undefined {
  try {
    // macOS·Linux 의 ps 둘 다 lstart 를 준다. 날짜 형식이 로케일을 따르지 않게 C 로케일로 읽는다.
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

/**
 * `pid` 가 `since` 무렵이나 그 전에 시작해 지금도 도는 같은 프로세스인가. 그 뒤에 시작한 프로세스는 pid 를 다시
 * 받은 다른 프로세스다. 시작 시각을 읽지 못하면 살아 있는지만 본다.
 */
export function isSameProcess(pid: number, since: Date): boolean {
  if (!isProcessAlive(pid)) return false;
  const started = processStartTime(pid);
  return started === undefined || started.getTime() <= since.getTime() + START_TOLERANCE_MS;
}

/** 잠금을 쥔 프로세스가 아직 그 잠금의 주인인가 */
export function holdsLock(lock: ServerLock): boolean {
  const since = new Date(lock.startedAt);
  if (Number.isNaN(since.getTime())) return isProcessAlive(lock.pid);
  return isSameProcess(lock.pid, since);
}

/** 잠금 파일을 읽는다. 없거나 모양이 틀리면 undefined 다 */
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

/** 살아 있는 주인이 쥔 잠금. 낡은 잠금이나 잠금이 없으면 undefined 다 */
export function readLiveServerLock(
  home: string,
  holds: (lock: ServerLock) => boolean = holdsLock,
): ServerLock | undefined {
  const lock = readServerLock(home);
  return lock !== undefined && holds(lock) ? lock : undefined;
}

export interface HeldServerLock {
  lock: ServerLock;
  /** 이 프로세스가 쓴 잠금일 때만 지운다. 여러 번 불러도 된다 */
  release(): void;
}

/**
 * 잠금을 쥔다. 살아 있는 다른 프로세스가 쥐고 있으면 ServerAlreadyRunningError 를 던진다.
 * 파일은 배타적으로 만들어(`wx`) 두 `start` 가 동시에 쥐려 해도 한쪽만 이긴다. 낡은 잠금은 치우기 파일을 쥔
 * 쪽만, 쥔 뒤에 다시 읽어 여전히 낡았을 때만 지운다. 그래서 다른 쪽이 막 새로 쓴 잠금을 지우지 않는다.
 */
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

/** 낡은 잠금을 지운다. 치우기 파일을 쥐지 못하면(다른 쪽이 치우는 중) 아무것도 하지 않는다 */
function breakStaleLock(home: string, holds: (lock: ServerLock) => boolean): void {
  const breaker = join(home, BREAK_FILE);
  try {
    writeFileSync(breaker, String(process.pid), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    // 치우던 프로세스가 중간에 죽어 남은 치우기 파일은 잠시 뒤 지운다.
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
