import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LogLevel, ProcessName } from "./fields.js";
import { fileSink } from "./file-sink.js";
import { followServerLogs, readServerLogs, redactStoredLine } from "./read.js";
import type { StoredLogLine } from "./read.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ganger-read-"));
  dirs.push(dir);
  return dir;
}

interface Entry {
  proc: ProcessName;
  second: number;
  level?: LogLevel;
  event?: string;
  runId?: string;
  ticketKey?: string;
}

function text(entry: Entry): string {
  const at = new Date(Date.UTC(2026, 10, 20, 0, 0, entry.second));
  return `${JSON.stringify({
    t: `${at.toISOString().slice(0, 23)}+00:00`,
    level: entry.level ?? "info",
    proc: entry.proc,
    pid: 100,
    v: "0.1.0",
    event: entry.event ?? `test.s${entry.second}`,
    msg: "a fixed sentence",
    ...(entry.runId === undefined ? {} : { runId: entry.runId }),
    ...(entry.ticketKey === undefined ? {} : { ticketKey: entry.ticketKey }),
  })}\n`;
}

function write(dir: string, name: string, entries: ReadonlyArray<Entry>): void {
  writeFileSync(join(dir, name), entries.map(text).join(""));
}

const events = (lines: ReadonlyArray<StoredLogLine>) => lines.map((line) => line.event);

describe("readServerLogs", () => {
  it("네 파일과 회전본을 합쳐 시각순으로 돌려준다", () => {
    const dir = tempDir();
    write(dir, "worker.jsonl.2", [{ proc: "worker", second: 1 }]);
    write(dir, "worker.jsonl.1", [
      { proc: "worker", second: 3 },
      { proc: "worker", second: 6 },
    ]);
    write(dir, "worker.jsonl", [{ proc: "worker", second: 8 }]);
    write(dir, "web.jsonl.1", [{ proc: "web", second: 2 }]);
    write(dir, "web.jsonl", [{ proc: "web", second: 7 }]);
    write(dir, "mcp.jsonl", [{ proc: "mcp", second: 4 }]);
    write(dir, "cli.jsonl", [{ proc: "cli", second: 5 }]);
    write(dir, "ganger.log", [{ proc: "cli", second: 0 }]);

    expect(events(readServerLogs(dir))).toEqual([
      "test.s1",
      "test.s2",
      "test.s3",
      "test.s4",
      "test.s5",
      "test.s6",
      "test.s7",
      "test.s8",
    ]);
  });

  it("같은 시각이면 파일 안 순서를 지킨다", () => {
    const dir = tempDir();
    write(dir, "worker.jsonl", [
      { proc: "worker", second: 1, event: "first.one" },
      { proc: "worker", second: 1, event: "second.one" },
    ]);
    expect(events(readServerLogs(dir))).toEqual(["first.one", "second.one"]);
  });

  it("프로세스·런·티켓·수준·시작 시각 거르기를 함께 쓴다", () => {
    const dir = tempDir();
    write(dir, "worker.jsonl", [
      { proc: "worker", second: 1, level: "warn", runId: "run-1", ticketKey: "ENG-1" },
      { proc: "worker", second: 2, level: "info", runId: "run-1", ticketKey: "ENG-1" },
      { proc: "worker", second: 3, level: "error", runId: "run-2", ticketKey: "ENG-2" },
      { proc: "worker", second: 4, level: "debug", runId: "run-1" },
      { proc: "worker", second: 5, level: "error", runId: "run-1" },
    ]);
    write(dir, "web.jsonl", [
      { proc: "web", second: 6, level: "warn", runId: "run-1", ticketKey: "ENG-1" },
      { proc: "web", second: 7, level: "info", ticketKey: "ENG-1" },
    ]);
    const since = new Date(Date.UTC(2026, 10, 20, 0, 0, 2));

    expect(events(readServerLogs(dir, { runId: "run-1", level: "warn" }))).toEqual([
      "test.s1",
      "test.s5",
      "test.s6",
    ]);
    expect(events(readServerLogs(dir, { procs: ["worker"], runId: "run-1", since }))).toEqual([
      "test.s2",
      "test.s4",
      "test.s5",
    ]);
    expect(events(readServerLogs(dir, { ticketKey: "ENG-1", procs: ["web"] }))).toEqual([
      "test.s6",
      "test.s7",
    ]);
    expect(events(readServerLogs(dir, { level: "error", since }))).toEqual(["test.s3", "test.s5"]);
    expect(readServerLogs(dir, { procs: ["mcp"] })).toEqual([]);
  });

  it("쓰다 죽은 줄과 고정 키가 없는 줄은 건너뛰고 나머지를 보인다", () => {
    const dir = tempDir();
    const broken = text({ proc: "worker", second: 2 }).slice(0, 40);
    writeFileSync(
      join(dir, "worker.jsonl"),
      [
        text({ proc: "worker", second: 1 }),
        `${broken}\n`,
        text({ proc: "worker", second: 3 }),
        `${JSON.stringify({ t: "2026-11-20T00:00:04.000+00:00", msg: "no level" })}\n`,
        "not json at all\n",
        text({ proc: "worker", second: 5 }),
        broken,
      ].join(""),
    );
    expect(events(readServerLogs(dir))).toEqual(["test.s1", "test.s3", "test.s5"]);
  });

  it("로그 폴더가 없으면 빈 목록이다", () => {
    expect(readServerLogs(join(tempDir(), "missing"))).toEqual([]);
  });
});

describe("followServerLogs", () => {
  it("처음엔 지금까지의 줄을, 다음부터는 새로 쓴 줄만 돌려준다", () => {
    const dir = tempDir();
    write(dir, "worker.jsonl.1", [{ proc: "worker", second: 1 }]);
    write(dir, "worker.jsonl", [{ proc: "worker", second: 2 }]);
    const follower = followServerLogs(dir);
    expect(events(follower.initial)).toEqual(["test.s1", "test.s2"]);
    expect(follower.poll()).toEqual([]);

    appendFileSync(join(dir, "worker.jsonl"), text({ proc: "worker", second: 3 }));
    appendFileSync(join(dir, "web.jsonl"), text({ proc: "web", second: 4 }));
    expect(events(follower.poll())).toEqual(["test.s3", "test.s4"]);
    expect(follower.poll()).toEqual([]);
  });

  it("회전을 넘어 잃는 줄 없이 이어 읽는다", () => {
    const dir = tempDir();
    const line = text({ proc: "worker", second: 0 });
    const sink = fileSink(join(dir, "worker.jsonl"), {
      maxBytes: Buffer.byteLength(line) * 3,
      files: 5,
    });
    sink.write(text({ proc: "worker", second: 1 }));
    const follower = followServerLogs(dir);
    expect(events(follower.initial)).toEqual(["test.s1"]);

    for (let second = 2; second <= 5; second += 1) sink.write(text({ proc: "worker", second }));
    expect(events(follower.poll())).toEqual(["test.s2", "test.s3", "test.s4", "test.s5"]);

    for (let second = 6; second <= 13; second += 1) sink.write(text({ proc: "worker", second }));
    expect(events(follower.poll())).toEqual([
      "test.s6",
      "test.s7",
      "test.s8",
      "test.s9",
      "test.s10",
      "test.s11",
      "test.s12",
      "test.s13",
    ]);
    sink.close();
  });

  it("줄바꿈이 오기 전의 줄은 다 쓰일 때까지 기다린다", () => {
    const dir = tempDir();
    const path = join(dir, "web.jsonl");
    writeFileSync(path, "");
    const follower = followServerLogs(dir);
    const whole = text({ proc: "web", second: 1 });
    appendFileSync(path, whole.slice(0, 30));
    expect(follower.poll()).toEqual([]);
    appendFileSync(path, whole.slice(30));
    expect(events(follower.poll())).toEqual(["test.s1"]);
  });

  it("거르기를 새 줄에도 적용한다", () => {
    const dir = tempDir();
    const follower = followServerLogs(dir, { runId: "run-1" });
    appendFileSync(join(dir, "worker.jsonl"), text({ proc: "worker", second: 1, runId: "run-2" }));
    appendFileSync(join(dir, "worker.jsonl"), text({ proc: "worker", second: 2, runId: "run-1" }));
    expect(events(follower.poll())).toEqual(["test.s2"]);
  });
});

describe("redactStoredLine", () => {
  it("파일에 남은 토큰 모양과 비밀 키 이름의 값을 가린다", () => {
    const line = {
      t: "2026-11-20T00:00:01.000+00:00",
      level: "warn" as const,
      proc: "worker" as const,
      pid: 1,
      v: "0.1.0",
      event: "runner.call",
      msg: "called the runner",
      reason: "auth failed for ghp_abcdefghijklmnopqrstuvwxyz",
      apiKey: "plain",
      err: { name: "Error", message: "Bearer abc.def" },
    };
    const redacted = JSON.stringify(redactStoredLine(line));
    expect(redacted).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
    expect(redacted).not.toContain("plain");
    expect(redacted).not.toContain("abc.def");
    expect(redacted).toContain("called the runner");
  });
});
