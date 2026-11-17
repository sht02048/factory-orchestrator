import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { BOOT_ENV } from "@factory/db";

/**
 * 설치 폴더(home). 부팅 설정 `.env`, 기본 SQLite 파일, 서비스 로그를 한 곳에 둔다.
 * 위치는 `--home`, 환경 변수 `FACTORY_HOME`, 운영자 홈의 `.factory-orchestrator` 순으로 정한다.
 * 이름 `factory-orchestrator`는 임시라(ADR 0005) 여기 한 곳에만 둔다.
 */
export const PRODUCT_NAME = "factory-orchestrator";
export const HOME_ENV = "FACTORY_HOME";

export interface HomePaths {
  home: string;
  envFile: string;
  /** `init`이 `DATABASE_PATH`로 넣는 기본값 */
  defaultDatabasePath: string;
  /** launchd가 표준 출력·오류를 남기는 폴더. systemd는 journal에 남긴다 */
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

/**
 * 부팅 값을 모은다. `.env` 파일 값 위에 셸 환경 변수의 부팅 값(넷)을 덮는다.
 * Node `--env-file`, dotenv처럼 셸에 이미 있는 값이 이긴다. 그 밖의 셸 변수는 보지 않는다.
 */
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
