import type { LogEvent } from "./events.js";
import { messageOf } from "./events.js";
import type { LogContext, LogFields, LogLevel, LogValue, ProcessName } from "./fields.js";
import { isFieldKey } from "./fields.js";
import { isSecretKey, redactValue, REDACTED, scrubText } from "./redact.js";

export const ERROR_TEXT_LIMIT = 500;
export const STACK_LIMIT = 4_000;
const CAUSE_DEPTH = 3;

export interface LineSource {
  proc: ProcessName;
  pid: number;
  version: string;
}

export interface SerializedError {
  name: string;
  message: string;
  code?: string;
  kind?: string;
  detail?: string;
  stack?: string;
  cause?: SerializedError;
}

export interface LogLine {
  t: string;
  level: LogLevel;
  proc: ProcessName;
  pid: number;
  v: string;
  event: LogEvent;
  msg: string;
  err?: SerializedError;
  [key: string]: unknown;
}

export function buildLine(
  source: LineSource,
  at: Date,
  level: LogLevel,
  event: LogEvent,
  context: LogContext,
  fields: LogFields,
): LogLine {
  const line: LogLine = {
    t: localIsoTime(at),
    level,
    proc: source.proc,
    pid: source.pid,
    v: source.version,
    event,
    msg: messageOf(event),
  };
  for (const [key, value] of [...Object.entries(context), ...Object.entries(fields)]) {
    if (!isFieldKey(key) || value === undefined) continue;
    const written = fieldValue(key, value);
    if (written !== undefined) line[key] = written;
  }
  if (fields.error !== undefined) line.err = serializeError(fields.error, CAUSE_DEPTH);
  return line;
}

export function formatLine(line: LogLine): string {
  return `${JSON.stringify(line)}\n`;
}

function fieldValue(key: string, value: unknown): LogValue | undefined {
  if (isSecretKey(key)) return REDACTED;
  if (typeof value === "string") return clip(scrubText(value), ERROR_TEXT_LIMIT);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean" || value === null) return value;
  return undefined;
}

export function serializeError(error: unknown, depth: number): SerializedError {
  if (!(error instanceof Error)) {
    return { name: "NonError", message: clip(scrubText(describe(error)), ERROR_TEXT_LIMIT) };
  }
  const serialized: SerializedError = {
    name: error.name,
    message: clip(scrubText(error.message), ERROR_TEXT_LIMIT),
  };
  const code = stringProperty(error, "code");
  if (code !== undefined) serialized.code = code;
  const detail = adapterDetail(error);
  if (detail.kind !== undefined) serialized.kind = detail.kind;
  if (detail.code !== undefined) serialized.code = detail.code;
  if (detail.text !== undefined) serialized.detail = clip(scrubText(detail.text), ERROR_TEXT_LIMIT);
  if (error.stack !== undefined) serialized.stack = clip(scrubText(error.stack), STACK_LIMIT);
  if (error.cause !== undefined && depth > 0) {
    serialized.cause = serializeError(error.cause, depth - 1);
  }
  return serialized;
}

function adapterDetail(error: Error): { kind?: string; code?: string; text?: string } {
  if (!("detail" in error) || typeof error.detail !== "object" || error.detail === null) return {};
  const detail = error.detail;
  const kind = stringProperty(detail, "kind");
  const code = stringProperty(detail, "code");
  const text = stringProperty(detail, "detail") ?? stringProperty(detail, "message");
  return {
    ...(kind === undefined ? {} : { kind }),
    ...(code === undefined ? {} : { code }),
    ...(text === undefined ? {} : { text }),
  };
}

function stringProperty(value: object, key: string): string | undefined {
  if (!(key in value)) return undefined;
  const found: unknown = Reflect.get(value, key);
  return typeof found === "string" ? found : undefined;
}

function describe(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(redactValue(value)) ?? String(value);
  } catch {
    return String(value);
  }
}

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

export function localIsoTime(at: Date): string {
  const offsetMinutes = -at.getTimezoneOffset();
  const local = new Date(at.getTime() + offsetMinutes * 60_000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const offset = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return `${local.toISOString().slice(0, 23)}${offset}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function humanLine(line: LogLine): string {
  const time = line.t.slice(11, 19);
  const extras = Object.entries(line)
    .filter(([key]) => !FIXED_KEYS.has(key))
    .map(([key, value]) => `${key}=${humanValue(value)}`);
  const err = line.err === undefined ? "" : ` error=${JSON.stringify(errorSummary(line.err))}`;
  const tail = extras.length === 0 ? "" : ` ${extras.join(" ")}`;
  return `${time} ${line.level.toUpperCase()} [${line.proc}] ${line.msg}${tail}${err}\n`;
}

function humanValue(value: unknown): string {
  if (typeof value === "string" && !/[\s"\p{Cc}]/u.test(value)) return value;
  return JSON.stringify(value) ?? String(value);
}

function errorSummary(err: SerializedError): string {
  const parts = [`${err.name}: ${err.message}`];
  if (err.kind !== undefined) parts.push(`kind=${err.kind}`);
  if (err.detail !== undefined) parts.push(err.detail);
  return parts.join(" ");
}

const FIXED_KEYS: ReadonlySet<string> = new Set([
  "t",
  "level",
  "proc",
  "pid",
  "v",
  "event",
  "msg",
  "err",
]);
