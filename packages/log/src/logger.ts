import { AsyncLocalStorage } from "node:async_hooks";
import type { LogEvent } from "./events.js";
import type { LogContext, LogFields, LogLevel, ProcessName } from "./fields.js";
import { isEnabled } from "./fields.js";
import { buildLine, formatLine } from "./line.js";
import type { LogLine } from "./line.js";

export interface Logger {
  error(event: LogEvent, fields?: LogFields): void;
  warn(event: LogEvent, fields?: LogFields): void;
  info(event: LogEvent, fields?: LogFields): void;
  debug(event: LogEvent, fields?: LogFields): void;
  enabled(level: LogLevel): boolean;
}

export interface LogSink {
  readonly minLevel?: LogLevel;
  write(line: LogLine, text: string): void;
}

export interface LoggerOptions {
  proc: ProcessName;
  version: string;
  pid?: number;
  level: () => LogLevel;
  sinks: ReadonlyArray<LogSink>;
  now?: () => Date;
  onSinkError?: (error: unknown) => void;
}

const contextStore = new AsyncLocalStorage<LogContext>();

export function withLogContext<T>(context: LogContext, fn: () => T): T {
  return contextStore.run({ ...contextStore.getStore(), ...context }, fn);
}

export function currentLogContext(): LogContext {
  return contextStore.getStore() ?? {};
}

export function createLogger(options: LoggerOptions): Logger {
  const source = { proc: options.proc, pid: options.pid ?? process.pid, version: options.version };
  const now = options.now ?? (() => new Date());
  const write = (level: LogLevel, event: LogEvent, fields: LogFields = {}): void => {
    if (!isEnabled(level, options.level())) return;
    const sinks = options.sinks.filter((sink) => isEnabled(level, sink.minLevel ?? "debug"));
    if (sinks.length === 0) return;
    const line = buildLine(source, now(), level, event, currentLogContext(), fields);
    const text = formatLine(line);
    for (const sink of sinks) {
      try {
        sink.write(line, text);
      } catch (error) {
        options.onSinkError?.(error);
      }
    }
  };
  return {
    error: (event, fields) => write("error", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    info: (event, fields) => write("info", event, fields),
    debug: (event, fields) => write("debug", event, fields),
    enabled: (level) => isEnabled(level, options.level()),
  };
}
