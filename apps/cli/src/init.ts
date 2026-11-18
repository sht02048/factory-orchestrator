import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual, parseEnv } from "node:util";
import { BOOT_ENV, ENCRYPTION_KEY_BYTES, parseBootConfig } from "@ganger/db";
import { homePaths } from "./home.js";

export interface InitOptions {
  home: string;
  host?: string;
  port?: string;
  databasePath?: string;
  generateKey?: () => string;
}

export type InitResult =
  | { created: true; envFile: string; host: string; port: number; databasePath: string }
  | { created: false; envFile: string };

export class EnvFileFormatError extends Error {
  constructor(variable: string) {
    super(
      `${variable} contains characters a .env file cannot hold (double quote, backslash, or line break)`,
    );
    this.name = "EnvFileFormatError";
  }
}

export function init(options: InitOptions): InitResult {
  const paths = homePaths(options.home);
  if (existsSync(paths.envFile)) return { created: false, envFile: paths.envFile };
  const values = {
    [BOOT_ENV.host]: options.host ?? "127.0.0.1",
    [BOOT_ENV.port]: options.port ?? "3000",
    [BOOT_ENV.databasePath]: resolve(options.databasePath ?? paths.defaultDatabasePath),
    [BOOT_ENV.encryptionKey]: (
      options.generateKey ?? (() => randomBytes(ENCRYPTION_KEY_BYTES).toString("base64"))
    )(),
  };
  const config = parseBootConfig(values);
  const contents = renderEnvFile(values);

  mkdirSync(paths.home, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(paths.envFile, contents, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (isAlreadyExists(error)) return { created: false, envFile: paths.envFile };
    throw error;
  }
  mkdirSync(dirname(config.databasePath), { recursive: true });
  return {
    created: true,
    envFile: paths.envFile,
    host: config.host,
    port: config.port,
    databasePath: config.databasePath,
  };
}

export function renderEnvFile(values: Readonly<Record<string, string>>): string {
  const line = (name: string): string => {
    const value = values[name] ?? "";
    return `${name}=${JSON.stringify(value)}`;
  };
  const contents = `# Boot settings for factory-orchestrator, written by \`factory-orchestrator init\`.
# Only the values needed to boot live here. Tokens (Linear, GitHub) are entered in
# web onboarding and stored encrypted in the database. Keep this file private.
# Shell environment variables with the same names override these values.

# Address and port the web server binds to. 127.0.0.1 accepts connections from
# this machine only; put a reverse proxy or tunnel in front to reach it from elsewhere.
${line(BOOT_ENV.host)}
${line(BOOT_ENV.port)}

# SQLite file shared by the web server and the worker (absolute path).
${line(BOOT_ENV.databasePath)}

# Key that encrypts the tokens stored in the database. If you lose or change it,
# you have to enter the tokens again.
${line(BOOT_ENV.encryptionKey)}
`;
  const parsed = parseEnv(contents);
  for (const [name, value] of Object.entries(values)) {
    if (!isDeepStrictEqual(parsed[name], value)) throw new EnvFileFormatError(name);
  }
  return contents;
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
