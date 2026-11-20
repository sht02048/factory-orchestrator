import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { LogLevel, ProcessName } from "./fields.js";
import { fileSink } from "./file-sink.js";
import { humanLine } from "./line.js";
import type { Logger, LogSink } from "./logger.js";
import { createLogger } from "./logger.js";
import { watchDebugSwitch } from "./debug-switch.js";
import { logFilePath, readLogSettings, REPORT_DIR_NAME } from "./settings.js";
import { GANGER_VERSION } from "./version.js";

export interface ConsoleStream {
  write(text: string): unknown;
}

export interface ProcessLogOptions {
  proc: ProcessName;
  env: Readonly<Record<string, string | undefined>>;
  console?: ConsoleStream | null;
  consoleLevel?: LogLevel;
  version?: string;
}

export interface ProcessLog {
  logger: Logger;
  file: string | null;
  setLevel(level: LogLevel): void;
  close(): void;
}

export const REPORTS_KEPT = 3;

let current: Logger = fallbackLogger("cli");

export function log(): Logger {
  return current;
}

export function useLogger(logger: Logger): () => void {
  const previous = current;
  current = logger;
  return () => {
    current = previous;
  };
}

export function useConsoleLogger(proc: ProcessName): void {
  current = fallbackLogger(proc);
}

function fallbackLogger(proc: ProcessName): Logger {
  return createLogger({
    proc,
    version: GANGER_VERSION,
    level: () => "warn",
    sinks: [consoleSink(process.stderr, "warn")],
  });
}

export function consoleSink(stream: ConsoleStream, minLevel: LogLevel): LogSink {
  return { minLevel, write: (line) => stream.write(humanLine(line)) };
}

export function setupProcessLog(options: ProcessLogOptions): ProcessLog {
  const settings = readLogSettings(options.env);
  const sinks: LogSink[] = [];
  const file = settings.dir === null ? null : logFilePath(settings.dir, options.proc);
  const sink = file === null ? undefined : fileSink(file, settings.limits);
  if (sink !== undefined) sinks.push({ write: (_line, text) => sink.write(text) });
  const stream = options.console === undefined ? process.stderr : options.console;
  if (stream !== null) sinks.push(consoleSink(stream, options.consoleLevel ?? "warn"));
  let level = settings.level;
  const debugSwitch = settings.home === null ? () => false : watchDebugSwitch(settings.home);
  let sinkFailed = false;
  const logger = createLogger({
    proc: options.proc,
    version: options.version ?? GANGER_VERSION,
    level: () => (debugSwitch() ? "debug" : level),
    sinks,
    onSinkError: (error) => {
      if (sinkFailed) return;
      sinkFailed = true;
      process.stderr.write(`could not write the server log: ${String(error)}\n`);
    },
    onSinkRecovered: () => {
      sinkFailed = false;
    },
  });
  current = logger;
  if (settings.dir !== null) setupFatalReport(join(settings.dir, REPORT_DIR_NAME));
  return {
    logger,
    file,
    setLevel: (next) => {
      level = next;
    },
    close: () => sink?.close(),
  };
}

export function processStartFields(): {
  node: string;
  platform: string;
  arch: string;
} {
  return { node: process.version, platform: process.platform, arch: process.arch };
}

export interface FatalTarget {
  prependListener(event: "uncaughtException", listener: (error: Error) => void): unknown;
  prependListener(event: "unhandledRejection", listener: (reason: unknown) => void): unknown;
}

export function exitOnFatal(
  target: FatalTarget,
  logger: () => Logger,
  exit: (code: number) => void,
): void {
  target.prependListener("uncaughtException", (error) => {
    logger().error("process.crashed", { reason: "uncaught-exception", error });
    exit(1);
  });
  target.prependListener("unhandledRejection", (reason) => {
    logger().error("process.crashed", { reason: "unhandled-rejection", error: reason });
    exit(1);
  });
}

function setupFatalReport(directory: string): void {
  const report = process.report;
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    pruneReports(directory, REPORTS_KEPT);
    report.directory = directory;
    report.excludeEnv = true;
    report.reportOnFatalError = true;
  } catch {
    return;
  }
}

export function pruneReports(directory: string, kept: number): void {
  const reports = readdirSync(directory)
    .filter((name) => name.startsWith("report.") && name.endsWith(".json"))
    .map((name) => ({ path: join(directory, name), at: statSync(join(directory, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  for (const old of reports.slice(kept)) rmSync(old.path, { force: true });
}
