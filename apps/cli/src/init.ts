import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual, parseEnv } from "node:util";
import { BOOT_ENV, ENCRYPTION_KEY_BYTES, parseBootConfig } from "@factory/db";
import { homePaths } from "./home.js";

export interface InitOptions {
  home: string;
  /** 바인딩 주소. 없으면 127.0.0.1(스펙 7절) */
  host?: string;
  port?: string;
  /** 없으면 home 안의 `data/factory-orchestrator.db`. 상대 경로는 현재 폴더 기준으로 푼다 */
  databasePath?: string;
  /** 시험에서 키를 정한다. 없으면 32바이트를 새로 뽑는다 */
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

/**
 * 부팅 설정 `.env`를 만든다(ADR 0005). 암호화 키는 새로 뽑는다.
 *
 * 이미 있으면 덮어쓰지 않고 그대로 둔다. 키를 바꾸면 DB에 저장한 토큰을 다시 입력해야 하기 때문이다.
 * 파일은 배타적으로 만들어(`wx`) 두 번 동시에 돌아도 한쪽만 쓴다.
 */
export function init(options: InitOptions): InitResult {
  const paths = homePaths(options.home);
  const values = {
    [BOOT_ENV.host]: options.host ?? "127.0.0.1",
    [BOOT_ENV.port]: options.port ?? "3000",
    [BOOT_ENV.databasePath]: resolve(options.databasePath ?? paths.defaultDatabasePath),
    [BOOT_ENV.encryptionKey]: (
      options.generateKey ?? (() => randomBytes(ENCRYPTION_KEY_BYTES).toString("base64"))
    )(),
  };
  // 쓰기 전에 start와 같은 규칙으로 검사한다. 틀린 값으로 파일을 만들지 않는다.
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

/** 사용자가 열어 보는 파일이라 설명은 영어로 쓴다(ADR 0005: 사용자 문서는 영어). */
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
  // JSON 문자열의 이스케이프를 .env 파서가 모두 풀지는 않는다. 다시 읽어 같은 값이 나오는지 확인한다.
  const parsed = parseEnv(contents);
  for (const [name, value] of Object.entries(values)) {
    if (!isDeepStrictEqual(parsed[name], value)) throw new EnvFileFormatError(name);
  }
  return contents;
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
