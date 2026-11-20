import type { LogEvent } from "./events.js";
import { messageOf } from "./events.js";
import type { LogFields, LogLevel } from "./fields.js";
import type { Logger } from "./logger.js";

export interface MemoryEntry {
  level: LogLevel;
  event: LogEvent;
  msg: string;
  fields: LogFields;
}

export interface MemoryLogger extends Logger {
  readonly entries: MemoryEntry[];
}

export function memoryLogger(): MemoryLogger {
  const entries: MemoryEntry[] = [];
  const record =
    (level: LogLevel) =>
    (event: LogEvent, fields: LogFields = {}): void => {
      entries.push({ level, event, msg: messageOf(event), fields });
    };
  return {
    entries,
    error: record("error"),
    warn: record("warn"),
    info: record("info"),
    debug: record("debug"),
    enabled: () => true,
  };
}

export const silentLogger: Logger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  enabled: () => false,
};
