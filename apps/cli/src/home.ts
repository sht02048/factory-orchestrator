import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { BOOT_ENV } from "@ganger/db";

export const PRODUCT_NAME = "factory-orchestrator";
export const HOME_ENV = "FACTORY_HOME";

export interface HomePaths {
  home: string;
  envFile: string;
  defaultDatabasePath: string;
  logDir: string;
}

export function resolveHome(
  flag: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
  userHome: string,
): string {
  const fromEnv = env[HOME_ENV]?.trim();
  if (flag !== undefined && flag.trim().length > 0) return resolve(flag);
  if (fromEnv !== undefined && fromEnv.length > 0) return resolve(fromEnv);
  return join(userHome, `.${PRODUCT_NAME}`);
}

export function homePaths(home: string): HomePaths {
  return {
    home,
    envFile: join(home, ".env"),
    defaultDatabasePath: join(home, "data", `${PRODUCT_NAME}.db`),
    logDir: join(home, "logs"),
  };
}

export class MissingEnvFileError extends Error {
  readonly envFile: string;

  constructor(envFile: string) {
    super(`boot settings not found: ${envFile}`);
    this.name = "MissingEnvFileError";
    this.envFile = envFile;
  }
}

export function readBootEnv(
  envFile: string,
  shellEnv: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  if (!existsSync(envFile)) throw new MissingEnvFileError(envFile);
  const values: Record<string, string | undefined> = { ...parseEnv(readFileSync(envFile, "utf8")) };
  for (const name of Object.values(BOOT_ENV)) {
    const value = shellEnv[name];
    if (value !== undefined) values[name] = value;
  }
  return values;
}
