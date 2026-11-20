import { appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { AppLayout } from "./layout.js";
import { parseLogsArgs } from "./logs.js";
import { runProgram } from "./program.js";
import type { ProgramContext } from "./program.js";

let dir: string;
let home: string;
let logs: string;
let out: string[];
let err: string[];
let stop: (() => void) | undefined;

const unusedLayout: AppLayout = {
  web: () => {
    throw new Error("not used");
  },
  worker: () => {
    throw new Error("not used");
  },
};

function context(overrides: Partial<ProgramContext> = {}): ProgramContext {
  return {
    env: { PATH: "/usr/bin:/bin" },
    platform: "darwin",
    userHome: dir,
    uid: 501,
    nodePath: "/opt/node/bin/node",
    cliEntry: "/opt/ganger/dist/bin/cli.js",
    layout: unusedLayout,
    runCommand: () => ({ ok: true }),
    holdSleepAssertion: () => ({ exited: new Promise(() => undefined), release: () => undefined }),
    version: "0.0.0-test",
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    onStopSignal: (handler) => {
      stop = () => handler("SIGINT");
    },
    ...overrides,
  };
}

function line(
  second: number,
  fields: Record<string, unknown> & { proc?: string; level?: string } = {},
): string {
  return `${JSON.stringify({
    t: `2026-11-20T09:00:${String(second).padStart(2, "0")}.000+09:00`,
    level: "info",
    proc: "worker",
    pid: 4121,
    v: "0.1.0",
    event: `test.s${second}`,
    msg: "called the runner",
    ...fields,
  })}\n`;
}

const eventOf = (text: string): string =>
  z.object({ event: z.string() }).parse(JSON.parse(text)).event;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ganger-cli-logs-"));
  home = join(dir, "home");
  logs = join(home, "logs");
  mkdirSync(logs, { recursive: true });
  out = [];
  err = [];
  stop = undefined;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("ganger logs", () => {
  it("회전본을 포함한 파일들을 시각순 한 줄씩 보인다", async () => {
    writeFileSync(join(logs, "worker.jsonl.1"), line(1, { runId: "run-1" }));
    writeFileSync(join(logs, "worker.jsonl"), line(4));
    writeFileSync(join(logs, "web.jsonl"), line(2, { proc: "web", level: "warn" }));
    writeFileSync(join(logs, "cli.jsonl"), line(3, { proc: "cli" }));

    expect(await runProgram(["logs", "--home", home], context())).toBe(0);
    expect(out).toEqual([
      "2026-11-20 09:00:01.000 INFO [worker] called the runner runId=run-1",
      "2026-11-20 09:00:02.000 WARN [web] called the runner",
      "2026-11-20 09:00:03.000 INFO [cli] called the runner",
      "2026-11-20 09:00:04.000 INFO [worker] called the runner",
    ]);
    expect(err).toEqual([]);
  });

  it("--json 은 저장된 줄을 그대로, 거르기를 함께 적용해 보인다", async () => {
    writeFileSync(
      join(logs, "worker.jsonl"),
      [
        line(1, { runId: "run-1", ticketKey: "ENG-1" }),
        line(2, { runId: "run-1", level: "warn" }),
        line(3, { runId: "run-2", level: "error" }),
      ].join(""),
    );
    writeFileSync(join(logs, "web.jsonl"), line(4, { proc: "web", runId: "run-1", level: "warn" }));

    const args = ["logs", "--home", home, "--json", "--run", "run-1", "--level", "WARN"];
    expect(await runProgram([...args, "--proc", "worker,mcp"], context())).toBe(0);
    expect(out).toEqual([line(2, { runId: "run-1", level: "warn" }).trimEnd()]);

    out = [];
    expect(await runProgram(["logs", "--home", home, "--ticket", "ENG-1"], context())).toBe(0);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("ticketKey=ENG-1");
  });

  it("쓰다 죽은 줄은 건너뛰고 나머지를 보인다", async () => {
    writeFileSync(join(logs, "worker.jsonl"), `${line(1)}${line(2).slice(0, 30)}\n${line(3)}`);
    expect(await runProgram(["logs", "--home", home, "--json"], context())).toBe(0);
    expect(out.map(eventOf)).toEqual(["test.s1", "test.s3"]);
  });

  it("--since 는 기간과 날짜를 받고, 잘못된 값은 쓰는 법과 함께 알린다", async () => {
    const now = new Date("2026-11-20T00:10:00Z");
    const parsed = parseLogsArgs({ since: "10m" }, now);
    expect(parsed).toMatchObject({ ok: true });
    expect(parsed.ok ? parsed.request.filter.since?.toISOString() : null).toBe(
      "2026-11-20T00:00:00.000Z",
    );
    expect(parseLogsArgs({ since: "2026-11-19T00:00:00Z" }, now)).toMatchObject({ ok: true });

    expect(await runProgram(["logs", "--home", home, "--since", "yesterday"], context())).toBe(2);
    expect(err.join("\n")).toContain('Cannot read --since "yesterday"');
    expect(await runProgram(["logs", "--home", home, "--proc", "db"], context())).toBe(2);
    expect(await runProgram(["logs", "--home", home, "--level", "loud"], context())).toBe(2);
    expect(await runProgram(["start", "--home", home, "--json"], context())).toBe(2);
  });

  it("로그가 없으면 어디를 봤는지 알린다", async () => {
    rmSync(logs, { recursive: true });
    expect(await runProgram(["logs", "--home", home], context())).toBe(0);
    expect(out).toEqual([]);
    expect(err.join("\n")).toContain(`No server logs in ${logs} yet.`);
  });

  it("systemd 서비스가 있으면 journald 안내를 stderr 에 쓴다", async () => {
    const unit = join(dir, ".config", "systemd", "user", "ganger.service");
    mkdirSync(join(dir, ".config", "systemd", "user"), { recursive: true });
    writeFileSync(unit, "");
    writeFileSync(join(logs, "worker.jsonl"), line(1));
    expect(await runProgram(["logs", "--home", home], context({ platform: "linux" }))).toBe(0);
    expect(err.join("\n")).toContain("journalctl --user -u ganger.service");
    expect(out).toHaveLength(1);
  });

  it("TTY 면 수준에 색을 입히고, 아니면 입히지 않는다", async () => {
    writeFileSync(join(logs, "worker.jsonl"), line(1, { level: "error" }));
    const tty = Object.assign(new PassThrough(), { isTTY: true });
    expect(await runProgram(["logs", "--home", home], context({ stdout: tty }))).toBe(0);
    expect(out[0]).toContain("\u001b[");
    out = [];
    const noColor = context({ stdout: tty, env: { NO_COLOR: "1" } });
    expect(await runProgram(["logs", "--home", home], noColor)).toBe(0);
    expect(out[0]).not.toContain("\u001b[");
    out = [];
    const emptyNoColor = context({ stdout: tty, env: { NO_COLOR: "" } });
    expect(await runProgram(["logs", "--home", home], emptyNoColor)).toBe(0);
    expect(out[0]).toContain("\u001b[");
  });

  it("-f 는 멈출 때까지 회전을 넘어 새 줄을 이어 보인다", async () => {
    const path = join(logs, "worker.jsonl");
    writeFileSync(path, line(1));
    const running = runProgram(["logs", "--home", home, "-f", "--json"], context());
    await new Promise((resolve) => setImmediate(resolve));
    expect(out).toHaveLength(1);

    appendFileSync(path, line(2));
    renameSync(path, join(logs, "worker.jsonl.1"));
    writeFileSync(path, line(3));
    stop?.();

    expect(await running).toBe(0);
    expect(out.map(eventOf)).toEqual(["test.s1", "test.s2", "test.s3"]);
  });
});
