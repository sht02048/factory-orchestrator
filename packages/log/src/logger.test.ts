import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  debugSwitchPath,
  readDebugSwitch,
  watchDebugSwitch,
  writeDebugSwitch,
} from "./debug-switch.js";
import { LOG_EVENTS } from "./events.js";
import type { LogLevel } from "./fields.js";
import type { LogLine } from "./line.js";
import { localIsoTime } from "./line.js";
import { createLogger, withLogContext } from "./logger.js";
import { exitOnFatal, setupProcessLog } from "./process-log.js";
import type { FatalTarget } from "./process-log.js";
import { REDACTED } from "./redact.js";
import { readLogSettings } from "./settings.js";
import { memoryLogger } from "./testing.js";

const eventLine = z.object({ event: z.string() });

const AT = new Date("2026-11-20T00:12:03.412Z");

function capture(level: LogLevel = "debug") {
  const lines: LogLine[] = [];
  const texts: string[] = [];
  const logger = createLogger({
    proc: "worker",
    version: "9.9.9",
    pid: 4121,
    level: () => level,
    now: () => AT,
    sinks: [
      {
        write: (line, text) => {
          lines.push(line);
          texts.push(text);
        },
      },
    ],
  });
  return { logger, lines, texts };
}

describe("log line", () => {
  it("starts with the fixed keys in a fixed order and ends with a newline", () => {
    const { logger, texts } = capture();
    logger.info("runner.call", { runId: "run-1", verb: "orchestration worker-start", ms: 12 });
    const text = texts[0] ?? "";
    expect(text.endsWith("\n")).toBe(true);
    const parsed: unknown = JSON.parse(text);
    expect(Object.keys(z.record(z.string(), z.unknown()).parse(parsed)).slice(0, 7)).toEqual([
      "t",
      "level",
      "proc",
      "pid",
      "v",
      "event",
      "msg",
    ]);
    expect(parsed).toMatchObject({
      t: localIsoTime(AT),
      level: "info",
      proc: "worker",
      pid: 4121,
      v: "9.9.9",
      event: "runner.call",
      msg: "called the runner",
      runId: "run-1",
      verb: "orchestration worker-start",
      ms: 12,
    });
  });

  it("writes the time with milliseconds and the local offset", () => {
    expect(localIsoTime(AT)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
  });

  it("keeps msg fixed per event so values never change it", () => {
    const { logger, lines } = capture();
    logger.warn("run.watch_failed", { runId: "run-a" });
    logger.warn("run.watch_failed", { runId: "run-b" });
    expect(new Set(lines.map((line) => line.msg))).toEqual(
      new Set([LOG_EVENTS["run.watch_failed"]]),
    );
  });

  it("names every event with dotted lowercase words", () => {
    for (const event of Object.keys(LOG_EVENTS)) {
      expect(event).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
    }
  });

  it("serializes errors with kind and cause", () => {
    const { logger, lines } = capture();
    const cause = new Error("socket closed");
    const error = Object.assign(new Error("adapter error: unreachable", { cause }), {
      name: "AdapterError",
      detail: { kind: "unreachable", detail: "ssh exited with 255" },
    });
    logger.warn("run.watch_failed", { error });
    expect(lines[0]?.err).toMatchObject({
      name: "AdapterError",
      kind: "unreachable",
      detail: "ssh exited with 255",
      cause: { name: "Error", message: "socket closed" },
    });
  });
});

describe("level filter", () => {
  it("drops lines below the threshold", () => {
    const { logger, lines } = capture("info");
    logger.debug("worker.tick", { ms: 3 });
    logger.info("process.started");
    logger.warn("run.watch_failed");
    logger.error("process.crashed");
    expect(lines.map((line) => line.level)).toEqual(["info", "warn", "error"]);
  });

  it("reads the level each time so it can change without a restart", () => {
    let level: LogLevel = "info";
    const lines: string[] = [];
    const logger = createLogger({
      proc: "web",
      version: "0",
      level: () => level,
      sinks: [{ write: (_line, text) => lines.push(text) }],
    });
    logger.debug("worker.tick");
    level = "debug";
    logger.debug("worker.tick");
    expect(lines).toHaveLength(1);
  });

  it("lets a sink take only warnings and errors", () => {
    const human: string[] = [];
    const logger = createLogger({
      proc: "web",
      version: "0",
      level: () => "debug",
      sinks: [{ minLevel: "warn", write: (line) => human.push(line.level) }],
    });
    logger.info("process.started");
    logger.warn("request.rejected");
    expect(human).toEqual(["warn"]);
  });

  it("reads the level from GANGER_LOG_LEVEL and falls back to info", () => {
    expect(readLogSettings({ GANGER_LOG_LEVEL: "DEBUG" }).level).toBe("debug");
    expect(readLogSettings({ GANGER_LOG_LEVEL: "loud" }).level).toBe("info");
    expect(readLogSettings({}).level).toBe("info");
  });
});

describe("redaction", () => {
  const secrets = [
    "Bearer abcdefghijklmnop1234",
    "lin_api_0123456789abcdefABCDEF",
    "ghp_0123456789abcdefghij0123",
    "github_pat_11ABCDEFG0123456789_abcdefghijk",
    "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAAB3Nza\n-----END OPENSSH PRIVATE KEY-----",
    "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
    "https://user:hunter2@example.com/repo.git",
  ];

  it.each(secrets)("removes token shaped text from messages and fields: %s", (secret) => {
    const { logger, texts } = capture();
    logger.warn("run.watch_failed", {
      reason: `failed with ${secret}`,
      error: new Error(`request failed: ${secret}`, { cause: new Error(secret) }),
    });
    const text = texts.join("");
    const needle = secret.includes("hunter2") ? "hunter2" : secret.slice(0, 24);
    expect(text).not.toContain(needle);
    expect(text).toContain(REDACTED);
  });

  it("always hides values under secret key names, even nested", () => {
    const { logger, texts } = capture();
    logger.warn("run.watch_failed", {
      error: { webhookSecret: "plain-secret-value", nested: { apiKey: "plain-api-key" } },
    });
    const text = texts.join("");
    expect(text).not.toContain("plain-secret-value");
    expect(text).not.toContain("plain-api-key");
  });

  it("never writes keys outside the allowed list, such as bodies, briefs or env", () => {
    const { logger, texts } = capture();
    const fields: Record<string, unknown> = {
      runId: "run-1",
      body: "ticket body text",
      brief: "agent brief text",
      prompt: "agent prompt text",
      env: { HOME: "/home/someone" },
      description: "ticket description",
    };
    logger.info("run.assigned", fields);
    const text = texts.join("");
    expect(text).toContain("run-1");
    for (const forbidden of ["ticket body", "agent brief", "agent prompt", "/home/someone"]) {
      expect(text).not.toContain(forbidden);
    }
    expect(text).not.toContain("ticket description");
  });

  it("drops object values even under allowed keys", () => {
    const { logger, lines } = capture();
    const fields: Record<string, unknown> = { reason: { body: "secret ticket body" } };
    logger.info("run.assigned", fields);
    expect(JSON.stringify(lines)).not.toContain("secret ticket body");
  });
});

describe("log context", () => {
  it("adds context fields across await and timers", async () => {
    const { logger, lines } = capture();
    await withLogContext({ runId: "run-1", runnerId: "runner-1" }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      await Promise.resolve();
      logger.info("run.state_changed", { from: "queued", to: "running" });
      await withLogContext({ deliveryId: "delivery-1" }, async () => {
        await new Promise((resolve) => setImmediate(resolve));
        logger.info("run.assigned");
      });
    });
    logger.info("process.alive");
    expect(lines.map((line) => [line["runId"], line["runnerId"], line["deliveryId"]])).toEqual([
      ["run-1", "runner-1", undefined],
      ["run-1", "runner-1", "delivery-1"],
      [undefined, undefined, undefined],
    ]);
  });

  it("keeps concurrent contexts apart", async () => {
    const { logger, lines } = capture();
    const work = (runId: string, delay: number) =>
      withLogContext({ runId }, async () => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        logger.info("worker.tick");
      });
    await Promise.all([work("run-slow", 5), work("run-fast", 0)]);
    expect(lines.map((line) => line["runId"])).toEqual(["run-fast", "run-slow"]);
  });

  it("lets explicit fields override the context", () => {
    const { logger, lines } = capture();
    withLogContext({ runId: "outer" }, () => logger.info("run.assigned", { runId: "inner" }));
    expect(lines[0]?.["runId"]).toBe("inner");
  });
});

describe("process log", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function home(): string {
    const dir = mkdtempSync(join(tmpdir(), "ganger-log-"));
    dirs.push(dir);
    return dir;
  }

  it("writes JSON lines to <home>/logs/<proc>.jsonl and only warnings to the console", () => {
    const gangerHome = home();
    const consoleText: string[] = [];
    const processLog = setupProcessLog({
      proc: "worker",
      env: { GANGER_HOME: gangerHome },
      console: { write: (text) => consoleText.push(text) },
    });
    processLog.logger.info("process.started");
    processLog.logger.debug("worker.tick");
    processLog.logger.warn("run.watch_failed", { runId: "run-1" });
    processLog.close();
    expect(processLog.file).toBe(join(gangerHome, "logs", "worker.jsonl"));
    const events = readFileSync(join(gangerHome, "logs", "worker.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => eventLine.parse(JSON.parse(line)).event);
    expect(events).toEqual(["process.started", "run.watch_failed"]);
    expect(consoleText).toHaveLength(1);
    expect(consoleText[0]).toMatch(/^\d{2}:\d{2}:\d{2} WARN \[worker\] could not watch run/);
  });

  it("writes nothing to the console when the console is turned off, as for mcp", () => {
    const gangerHome = home();
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const processLog = setupProcessLog({
        proc: "mcp",
        env: { GANGER_HOME: gangerHome },
        console: null,
      });
      processLog.logger.error("process.crashed", { error: new Error("boom") });
      processLog.logger.info("process.started");
      processLog.close();
      expect(stdout).not.toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
    }
    expect(readFileSync(join(gangerHome, "logs", "mcp.jsonl"), "utf8")).toContain("boom");
  });

  it("changes the level without a restart and creates the file for the owner only", () => {
    const gangerHome = home();
    const processLog = setupProcessLog({
      proc: "worker",
      env: { GANGER_HOME: gangerHome },
      console: null,
    });
    processLog.logger.debug("worker.tick");
    processLog.setLevel("debug");
    processLog.logger.debug("worker.tick");
    processLog.close();
    const file = join(gangerHome, "logs", "worker.jsonl");
    expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(1);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(gangerHome, "logs")).mode & 0o777).toBe(0o700);
    expect(statSync(join(gangerHome, "logs", "reports")).mode & 0o777).toBe(0o700);
  });

  it("follows the Settings debug switch from the next line in web, worker and mcp without a restart", () => {
    const gangerHome = home();
    const procs = ["web", "worker", "mcp"] as const;
    const logs = procs.map((proc) =>
      setupProcessLog({ proc, env: { GANGER_HOME: gangerHome }, console: null }),
    );
    const tickAll = () => {
      for (const processLog of logs) processLog.logger.debug("worker.tick");
    };
    tickAll();
    writeDebugSwitch(gangerHome, true);
    tickAll();
    tickAll();
    writeDebugSwitch(gangerHome, false);
    tickAll();
    for (const processLog of logs) processLog.close();
    for (const proc of procs) {
      const lines = readFileSync(join(gangerHome, "logs", `${proc}.jsonl`), "utf8")
        .trim()
        .split("\n");
      expect(lines.map((line) => eventLine.parse(JSON.parse(line)).event)).toEqual([
        "worker.tick",
        "worker.tick",
      ]);
    }
  });

  it("treats a missing or broken switch file as off and keeps GANGER_LOG_LEVEL", () => {
    const gangerHome = home();
    const switchOf = watchDebugSwitch(gangerHome);
    expect(switchOf()).toBe(false);
    writeFileSync(debugSwitchPath(gangerHome), "{not json");
    expect(switchOf()).toBe(false);
    writeDebugSwitch(gangerHome, true);
    expect(switchOf()).toBe(true);
    expect(readDebugSwitch(gangerHome)).toBe(true);
    expect(statSync(debugSwitchPath(gangerHome)).mode & 0o777).toBe(0o600);
    rmSync(debugSwitchPath(gangerHome));
    expect(switchOf()).toBe(false);
    const processLog = setupProcessLog({
      proc: "worker",
      env: { GANGER_HOME: gangerHome, GANGER_LOG_LEVEL: "debug" },
      console: null,
    });
    processLog.logger.debug("worker.tick");
    processLog.close();
    expect(readFileSync(join(gangerHome, "logs", "worker.jsonl"), "utf8")).toContain("worker.tick");
  });

  it("keeps a console line on one line when a value has a newline", () => {
    const consoleText: string[] = [];
    const processLog = setupProcessLog({
      proc: "worker",
      env: {},
      console: { write: (text) => consoleText.push(text) },
    });
    processLog.logger.warn("run.start_failed", { reason: "first\nsecond" });
    processLog.close();
    expect(consoleText.join("").trimEnd().split("\n")).toHaveLength(1);
    expect(consoleText.join("")).toContain('reason="first\\nsecond"');
  });

  it("writes no file without a home, as in development", () => {
    const processLog = setupProcessLog({ proc: "web", env: {}, console: null });
    expect(processLog.file).toBeNull();
    processLog.close();
  });
});

describe("fatal errors", () => {
  it("runs before handlers a host such as srvx registered earlier", () => {
    const target = new EventEmitter();
    const order: string[] = [];
    target.on("uncaughtException", () => order.push("host"));
    exitOnFatal(
      target,
      () => ({ ...memoryLogger(), error: () => order.push("log") }),
      () => order.push("exit"),
    );
    target.emit("uncaughtException", new Error("boom"));
    expect(order).toEqual(["log", "exit", "host"]);
  });

  it("writes an error line and exits on uncaught exceptions and rejections", () => {
    let onException: (error: Error) => void = () => undefined;
    let onRejection: (reason: unknown) => void = () => undefined;
    const target: FatalTarget = {
      prependListener: (event: "uncaughtException" | "unhandledRejection", listener: never) => {
        if (event === "uncaughtException") onException = listener;
        else onRejection = listener;
      },
    };
    const logger = memoryLogger();
    const exits: number[] = [];
    exitOnFatal(
      target,
      () => logger,
      (code) => exits.push(code),
    );
    onException(new Error("boom"));
    onRejection("rejected");
    expect(logger.entries.map((entry) => [entry.level, entry.event, entry.fields.reason])).toEqual([
      ["error", "process.crashed", "uncaught-exception"],
      ["error", "process.crashed", "unhandled-rejection"],
    ]);
    expect(exits).toEqual([1, 1]);
  });
});
