import { join } from "node:path";
import { z } from "zod";
import type { LogLevel, ProcessName } from "./fields.js";
import { LOG_LEVELS } from "./fields.js";
import type { RotationLimits } from "./file-sink.js";

export const LOG_ENV = {
  level: "GANGER_LOG_LEVEL",
  maxMb: "GANGER_LOG_MAX_MB",
  files: "GANGER_LOG_FILES",
  home: "GANGER_HOME",
} as const;

export const DEFAULT_LOG_LEVEL: LogLevel = "info";
export const DEFAULT_LOG_MAX_MB = 10;
export const DEFAULT_LOG_FILES = 5;
export const LOG_DIR_NAME = "logs";
export const REPORT_DIR_NAME = "reports";

const levelSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.enum(LOG_LEVELS))
  .catch(DEFAULT_LOG_LEVEL);
const maxMbSchema = z.coerce.number().positive().max(1_024).catch(DEFAULT_LOG_MAX_MB);
const filesSchema = z.coerce.number().int().min(0).max(50).catch(DEFAULT_LOG_FILES);

export interface LogSettings {
  level: LogLevel;
  limits: RotationLimits;
  dir: string | null;
  home: string | null;
}

type Env = Readonly<Record<string, string | undefined>>;

function present(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
}

export function readLogSettings(env: Env): LogSettings {
  const level = present(env[LOG_ENV.level]);
  const maxMb = present(env[LOG_ENV.maxMb]);
  const files = present(env[LOG_ENV.files]);
  const home = present(env[LOG_ENV.home]);
  return {
    level: level === undefined ? DEFAULT_LOG_LEVEL : levelSchema.parse(level),
    limits: {
      maxBytes: Math.round(
        (maxMb === undefined ? DEFAULT_LOG_MAX_MB : maxMbSchema.parse(maxMb)) * 1024 * 1024,
      ),
      files: files === undefined ? DEFAULT_LOG_FILES : filesSchema.parse(files),
    },
    dir: home === undefined ? null : logDir(home),
    home: home ?? null,
  };
}

export function logDir(home: string): string {
  return join(home, LOG_DIR_NAME);
}

export function logFilePath(dir: string, proc: ProcessName): string {
  return join(dir, `${proc}.jsonl`);
}
