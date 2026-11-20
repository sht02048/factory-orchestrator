import {
  closeSync,
  fstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { LogLevel, ProcessName } from "./fields.js";
import { isEnabled, LOG_LEVELS, PROCESS_NAMES } from "./fields.js";
import { isSecretKey, redactValue, REDACTED, scrubText } from "./redact.js";
import { logFilePath } from "./settings.js";

const storedLineSchema = z.looseObject({
  t: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  level: z.enum(LOG_LEVELS),
  proc: z.enum(PROCESS_NAMES),
  pid: z.number(),
  v: z.string(),
  event: z.string(),
  msg: z.string(),
});

export type StoredLogLine = z.infer<typeof storedLineSchema>;

export interface LogFilter {
  procs?: ReadonlyArray<ProcessName>;
  runId?: string;
  ticketKey?: string;
  level?: LogLevel;
  since?: Date;
}

export function parseLogLine(text: string): StoredLogLine | undefined {
  if (text.trim() === "") return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parsed = storedLineSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function redactStoredLine(line: StoredLogLine): StoredLogLine {
  const { t, level, proc, pid, v, event, msg, ...rest } = line;
  const redacted: StoredLogLine = {
    t,
    level,
    proc,
    pid,
    v: scrubText(v),
    event: scrubText(event),
    msg: scrubText(msg),
  };
  for (const [key, value] of Object.entries(rest)) {
    redacted[key] = isSecretKey(key) ? REDACTED : redactValue(value);
  }
  return redacted;
}

export function matchesLogFilter(line: StoredLogLine, filter: LogFilter): boolean {
  if (filter.procs !== undefined && !filter.procs.includes(line.proc)) return false;
  if (filter.runId !== undefined && line["runId"] !== filter.runId) return false;
  if (filter.ticketKey !== undefined && line["ticketKey"] !== filter.ticketKey) return false;
  if (filter.level !== undefined && !isEnabled(line.level, filter.level)) return false;
  if (filter.since !== undefined && Date.parse(line.t) < filter.since.getTime()) return false;
  return true;
}

export function logFilesOldestFirst(dir: string, proc: ProcessName): string[] {
  const current = `${proc}.jsonl`;
  const rotated = new RegExp(`^${proc}\\.jsonl\\.(\\d+)$`);
  const names = listDir(dir);
  const older = names
    .map((name) => ({ name, index: Number(rotated.exec(name)?.[1] ?? Number.NaN) }))
    .filter((file) => Number.isInteger(file.index) && file.index > 0)
    .sort((a, b) => b.index - a.index)
    .map((file) => join(dir, file.name));
  return names.includes(current) ? [...older, join(dir, current)] : older;
}

export function readServerLogs(dir: string, filter: LogFilter = {}): StoredLogLine[] {
  const lines: StoredLogLine[] = [];
  for (const proc of filter.procs ?? PROCESS_NAMES) {
    for (const file of logFilesOldestFirst(dir, proc)) {
      for (const line of parseText(readText(file))) {
        if (matchesLogFilter(line, filter)) lines.push(line);
      }
    }
  }
  return inTimeOrder(lines);
}

export interface LogFollower {
  readonly initial: ReadonlyArray<StoredLogLine>;
  poll(): StoredLogLine[];
}

interface FollowState {
  ino: number | undefined;
  offset: number;
  pending: Buffer;
}

export function followServerLogs(dir: string, filter: LogFilter = {}): LogFollower {
  const procs = filter.procs ?? PROCESS_NAMES;
  const states = new Map<ProcessName, FollowState>();
  const initial: StoredLogLine[] = [];

  for (const proc of procs) {
    const current = logFilePath(dir, proc);
    for (const file of logFilesOldestFirst(dir, proc).filter((path) => path !== current)) {
      initial.push(...parseText(readText(file)));
    }
    const state: FollowState = { ino: undefined, offset: 0, pending: Buffer.alloc(0) };
    initial.push(...readCurrent(current, state));
    states.set(proc, state);
  }

  return {
    initial: inTimeOrder(initial.filter((line) => matchesLogFilter(line, filter))),
    poll: () => {
      const fresh: StoredLogLine[] = [];
      for (const proc of procs) {
        const state = states.get(proc);
        if (state === undefined) continue;
        fresh.push(...pollProc(dir, proc, state));
      }
      return inTimeOrder(fresh.filter((line) => matchesLogFilter(line, filter)));
    },
  };
}

function pollProc(dir: string, proc: ProcessName, state: FollowState): StoredLogLine[] {
  const current = logFilePath(dir, proc);
  const lines: StoredLogLine[] = [];
  if (state.ino !== undefined && inodeOf(current) !== state.ino) {
    const rotated = logFilesOldestFirst(dir, proc).filter((path) => path !== current);
    const movedAt = rotated.findIndex((path) => inodeOf(path) === state.ino);
    const moved = rotated[movedAt];
    if (moved !== undefined) {
      const rest = readBytesFrom(moved, state.ino, state.offset);
      if (rest !== undefined) lines.push(...parseBuffer(Buffer.concat([state.pending, rest])));
      for (const newer of rotated.slice(movedAt + 1)) lines.push(...parseText(readText(newer)));
    }
    state.ino = undefined;
    state.offset = 0;
    state.pending = Buffer.alloc(0);
  }
  lines.push(...readCurrent(current, state));
  return lines;
}

function readCurrent(path: string, state: FollowState): StoredLogLine[] {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return [];
  }
  try {
    const stat = fstatSync(fd);
    if (state.ino !== stat.ino) {
      state.ino = stat.ino;
      state.offset = 0;
      state.pending = Buffer.alloc(0);
    }
    if (stat.size < state.offset) {
      state.offset = 0;
      state.pending = Buffer.alloc(0);
    }
    const chunk = readRange(fd, state.offset, stat.size);
    state.offset = stat.size;
    const joined = Buffer.concat([state.pending, chunk]);
    const end = joined.lastIndexOf(0x0a);
    state.pending = Buffer.from(joined.subarray(end + 1));
    return end < 0 ? [] : parseBuffer(joined.subarray(0, end + 1));
  } finally {
    closeSync(fd);
  }
}

function readBytesFrom(path: string, ino: number, offset: number): Buffer | undefined {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return undefined;
  }
  try {
    const stat = fstatSync(fd);
    if (stat.ino !== ino) return undefined;
    return readRange(fd, Math.min(offset, stat.size), stat.size);
  } finally {
    closeSync(fd);
  }
}

function readRange(fd: number, from: number, to: number): Buffer {
  const buffer = Buffer.alloc(Math.max(0, to - from));
  let read = 0;
  while (read < buffer.length) {
    const count = readSync(fd, buffer, read, buffer.length - read, from + read);
    if (count === 0) break;
    read += count;
  }
  return buffer.subarray(0, read);
}

function parseBuffer(buffer: Buffer): StoredLogLine[] {
  return parseText(buffer.toString("utf8"));
}

function parseText(text: string): StoredLogLine[] {
  const lines: StoredLogLine[] = [];
  for (const piece of text.split("\n")) {
    const line = parseLogLine(piece);
    if (line !== undefined) lines.push(line);
  }
  return lines;
}

function inTimeOrder(lines: StoredLogLine[]): StoredLogLine[] {
  return lines
    .map((line, order) => ({ line, at: Date.parse(line.t), order }))
    .sort((a, b) => a.at - b.at || a.order - b.order)
    .map((entry) => entry.line);
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function inodeOf(path: string): number | undefined {
  try {
    return statSync(path).ino;
  } catch {
    return undefined;
  }
}
