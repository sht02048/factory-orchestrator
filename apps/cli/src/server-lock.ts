import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/*
 * 서버 잠금 파일(티켓 0046). `start`가 home 에 web·worker 를 띄우는 동안 `<home>/server.lock` 을 쥔다.
 * 같은 home 에 `start` 가 두 벌 뜨지 않게 막고(데스크톱 앱의 ②와 헤드리스 서비스 ③이 같은 코드를 쓴다),
 * 데스크톱 앱이 도는 서버를 찾아 붙을 때 읽는다. 모양을 바꾸면 apps/desktop 도 함께 바꾼다.
 *
 * 파일이 남아 있어도 적힌 프로세스가 없으면(SIGKILL, 전원 꺼짐) 낡은 잠금으로 보고 새로 쥔다.
 */

export const SERVER_LOCK_FILE = "server.lock";

export const serverLockSchema = z.object({
  /** 잠금을 쥔 `start` 프로세스 */
  pid: z.number().int().positive(),
  /** web 에 닿는 주소(start 의 webUrl) */
  url: z.string(),
  /** ISO 8601 */
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

/** 프로세스가 살아 있는가. 신호 0 은 보내지 않고 권한·존재만 본다. 다른 계정의 프로세스(EPERM)도 살아 있다 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

/** 잠금 파일을 읽는다. 없거나 모양이 틀리면 undefined 다(틀린 파일은 쥔 프로세스를 알 수 없어 낡은 잠금으로 본다) */
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

/** 살아 있는 프로세스가 쥔 잠금. 낡은 잠금이나 잠금이 없으면 undefined 다 */
export function readLiveServerLock(
  home: string,
  isAlive: (pid: number) => boolean = isProcessAlive,
): ServerLock | undefined {
  const lock = readServerLock(home);
  return lock !== undefined && isAlive(lock.pid) ? lock : undefined;
}

export interface HeldServerLock {
  lock: ServerLock;
  /** 이 프로세스가 쓴 잠금일 때만 지운다. 여러 번 불러도 된다 */
  release(): void;
}

/**
 * 잠금을 쥔다. 살아 있는 다른 프로세스가 쥐고 있으면 ServerAlreadyRunningError 를 던진다.
 * 파일은 배타적으로 만들어(`wx`) 두 `start` 가 동시에 쥐려 해도 한쪽만 이긴다.
 */
export function acquireServerLock(
  home: string,
  entry: Omit<ServerLock, "startedAt"> & { startedAt?: string },
  isAlive: (pid: number) => boolean = isProcessAlive,
): HeldServerLock {
  const lock: ServerLock = { ...entry, startedAt: entry.startedAt ?? new Date().toISOString() };
  const path = serverLockPath(home);
  // 낡은 잠금을 지우고 다시 쥐는 사이에 다른 프로세스가 먼저 쥘 수 있어 몇 번만 되풀이한다.
  for (let attempt = 0; attempt < 3; attempt += 1) {
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
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
    const current = readServerLock(home);
    if (current !== undefined && current.pid !== lock.pid && isAlive(current.pid)) {
      throw new ServerAlreadyRunningError(current);
    }
    rmSync(path, { force: true });
  }
  const current = readServerLock(home);
  throw new ServerAlreadyRunningError(
    current ?? { pid: lock.pid, url: lock.url, startedAt: lock.startedAt },
  );
}
