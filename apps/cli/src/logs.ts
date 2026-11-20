import { styleText } from "node:util";
import {
  LOG_LEVELS,
  PROCESS_NAMES,
  followServerLogs,
  humanLine,
  logFilesOldestFirst,
  readServerLogs,
} from "@ganger/log";
import type { LogFilter, LogLevel, ProcessName, StoredLogLine } from "@ganger/log";
import { z } from "zod";
import { messages } from "./messages.js";

export const FOLLOW_POLL_MS = 500;

export interface LogsArgs {
  proc?: ReadonlyArray<string> | undefined;
  run?: string | undefined;
  ticket?: string | undefined;
  level?: string | undefined;
  since?: string | undefined;
  follow?: boolean | undefined;
  json?: boolean | undefined;
}

export interface LogsRequest {
  filter: LogFilter;
  follow: boolean;
  json: boolean;
}

export type ParsedLogs = { ok: true; request: LogsRequest } | { ok: false; error: string };

const procSchema = z.enum(PROCESS_NAMES);
const levelSchema = z.string().trim().toLowerCase().pipe(z.enum(LOG_LEVELS));
const DURATION = /^(\d+)\s*([smhd])$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const UNIT_MS: Readonly<Record<string, number>> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseLogsArgs(args: LogsArgs, now: Date): ParsedLogs {
  const filter: { -readonly [K in keyof LogFilter]: LogFilter[K] } = {};
  if (args.proc !== undefined) {
    const names = args.proc.flatMap((value) => value.split(",")).map((value) => value.trim());
    const procs: ProcessName[] = [];
    for (const name of names) {
      const parsed = procSchema.safeParse(name);
      if (!parsed.success) return { ok: false, error: messages.logs.badProc(name) };
      procs.push(parsed.data);
    }
    filter.procs = procs;
  }
  if (args.run !== undefined) filter.runId = args.run;
  if (args.ticket !== undefined) filter.ticketKey = args.ticket;
  if (args.level !== undefined) {
    const parsed = levelSchema.safeParse(args.level);
    if (!parsed.success) return { ok: false, error: messages.logs.badLevel(args.level) };
    filter.level = parsed.data;
  }
  if (args.since !== undefined) {
    const since = parseSince(args.since, now);
    if (since === undefined) return { ok: false, error: messages.logs.badSince(args.since) };
    filter.since = since;
  }
  return {
    ok: true,
    request: { filter, follow: args.follow === true, json: args.json === true },
  };
}

function parseSince(value: string, now: Date): Date | undefined {
  const duration = DURATION.exec(value.trim());
  if (duration !== null) {
    const unit = UNIT_MS[(duration[2] ?? "").toLowerCase()];
    if (unit === undefined) return undefined;
    return new Date(now.getTime() - Number(duration[1]) * unit);
  }
  if (!ISO_DATE.test(value.trim())) return undefined;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : new Date(at);
}

export interface LogsIo {
  out(line: string): void;
  err(line: string): void;
  color: boolean;
  onStopSignal(handler: () => void): void;
}

export async function showServerLogs(
  io: LogsIo,
  dir: string,
  request: LogsRequest,
): Promise<number> {
  if (!hasLogFiles(dir)) {
    io.err(messages.logs.none(dir));
    if (!request.follow) return 0;
  }
  const print = (lines: ReadonlyArray<StoredLogLine>) => {
    for (const line of lines) io.out(request.json ? JSON.stringify(line) : pretty(line, io.color));
  };
  if (!request.follow) {
    const lines = readServerLogs(dir, request.filter);
    if (lines.length === 0 && hasLogFiles(dir)) io.err(messages.logs.noMatch);
    print(lines);
    return 0;
  }
  const follower = followServerLogs(dir, request.filter);
  print(follower.initial);
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => print(follower.poll()), FOLLOW_POLL_MS);
    io.onStopSignal(() => {
      clearInterval(timer);
      print(follower.poll());
      resolve();
    });
  });
  return 0;
}

function hasLogFiles(dir: string): boolean {
  return PROCESS_NAMES.some((proc) => logFilesOldestFirst(dir, proc).length > 0);
}

const LEVEL_COLORS: Readonly<Record<LogLevel, Parameters<typeof styleText>[0]>> = {
  error: "red",
  warn: "yellow",
  info: "green",
  debug: "gray",
};

function pretty(line: StoredLogLine, color: boolean): string {
  const text = humanLine(line, {
    date: true,
    ...(color
      ? {
          paint: (level: LogLevel, label: string) =>
            styleText(LEVEL_COLORS[level], label, { validateStream: false }),
        }
      : {}),
  });
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}
