import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ServerAlreadyRunningError,
  acquireServerLock,
  holdsLock,
  readLiveServerLock,
  serverLockPath,
} from "./server-lock.js";

/*
 * 서버 잠금(0046). 같은 home 에 start 가 한 벌만 돈다. start 와 함께 도는 시험은 start.test.ts 에 있다.
 */

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "factory-lock-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("서버 잠금", () => {
  it("살아 있는 주인이 쥔 잠금은 다른 프로세스가 쥐지 못한다", () => {
    const held = acquireServerLock(home, { pid: process.pid, url: "http://127.0.0.1:1" });
    expect(() => acquireServerLock(home, { pid: process.ppid, url: "http://127.0.0.1:2" })).toThrow(
      ServerAlreadyRunningError,
    );
    held.release();
    expect(existsSync(serverLockPath(home))).toBe(false);
  });

  it("pid 가 잠금을 쓴 뒤에 시작한 다른 프로세스에 다시 쓰였으면 낡은 잠금으로 보고 새로 쥔다", () => {
    // 재부팅 뒤 같은 pid 를 받은 프로세스: 이 시험 프로세스는 2000년 뒤에 시작했다.
    const stale = {
      pid: process.pid,
      url: "http://127.0.0.1:1",
      startedAt: "2000-01-01T00:00:00.000Z",
    };
    writeFileSync(serverLockPath(home), JSON.stringify(stale));
    expect(holdsLock(stale)).toBe(false);
    expect(readLiveServerLock(home)).toBeUndefined();

    const held = acquireServerLock(home, { pid: process.pid, url: "http://127.0.0.1:2" });
    expect(held.lock.url).toBe("http://127.0.0.1:2");
    held.release();
  });

  it("막 만들어 아직 내용이 없는 잠금은 지우지 않는다", () => {
    writeFileSync(serverLockPath(home), "");
    expect(() => acquireServerLock(home, { pid: process.pid, url: "http://127.0.0.1:1" })).toThrow(
      ServerAlreadyRunningError,
    );
    expect(readFileSync(serverLockPath(home), "utf8")).toBe("");
  });

  it("여러 프로세스가 같은 낡은 잠금을 동시에 치워도 한 프로세스만 쥔다", async () => {
    writeFileSync(
      serverLockPath(home),
      JSON.stringify({
        pid: 999_999,
        url: "http://127.0.0.1:1",
        startedAt: "2000-01-01T00:00:00.000Z",
      }),
    );
    // 각 프로세스가 같은 규칙(server-lock.ts 와 같은 치우기 파일 절차)으로 잠금을 쥐려 한다.
    const script = `
      import { acquireServerLock } from ${JSON.stringify(new URL("./server-lock.ts", import.meta.url).href)};
      try {
        acquireServerLock(process.argv[1], { pid: process.pid, url: "x" });
        console.log("won");
        setTimeout(() => {}, 1500);
      } catch { console.log("lost"); }
    `;
    const results = await Promise.all(
      Array.from(
        { length: 6 },
        () =>
          new Promise<string>((resolve) => {
            const child = spawn(process.execPath, ["--input-type=module", "-e", script, home], {
              stdio: ["ignore", "pipe", "ignore"],
            });
            let out = "";
            child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
            child.once("exit", () => resolve(out.trim()));
          }),
      ),
    );
    expect(results.filter((result) => result === "won")).toHaveLength(1);
  });
});
