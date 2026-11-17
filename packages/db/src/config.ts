import { z } from "zod";

/**
 * 부팅 설정. `.env`(셸 환경 변수)에는 이 넷만 둔다(ADR 0005, 스펙 7절, Q58).
 * 토큰은 여기 두지 않고 DB에 암호화해 저장한다.
 *
 * | 환경 변수        | 뜻                      | 기본값        |
 * | ---------------- | ----------------------- | ------------- |
 * | `WEB_HOST`       | web 서버 바인딩 주소    | `127.0.0.1`   |
 * | `WEB_PORT`       | web 서버 포트           | `3000`        |
 * | `DATABASE_PATH`  | SQLite 파일 경로        | 없음(필수)    |
 * | `ENCRYPTION_KEY` | 토큰 암호화 키(base64)  | 없음(필수)    |
 */
export interface BootConfig {
  host: string;
  port: number;
  databasePath: string;
  /** AES-256 키 32바이트 */
  encryptionKey: Uint8Array;
}

export const BOOT_ENV = {
  host: "WEB_HOST",
  port: "WEB_PORT",
  databasePath: "DATABASE_PATH",
  encryptionKey: "ENCRYPTION_KEY",
} as const;

export const ENCRYPTION_KEY_BYTES = 32;

export interface BootConfigIssue {
  /** 문제가 있는 환경 변수 이름 */
  variable: string;
  message: string;
}

/** 부팅 값이 빠지거나 형식이 틀림. 메시지에 값 자체는 넣지 않는다(암호화 키가 로그에 남지 않게). */
export class BootConfigError extends Error {
  readonly issues: ReadonlyArray<BootConfigIssue>;

  constructor(issues: ReadonlyArray<BootConfigIssue>) {
    super(
      `boot configuration is invalid: ${issues.map((i) => `${i.variable} ${i.message}`).join("; ")}`,
    );
    this.name = "BootConfigError";
    this.issues = issues;
  }
}

const required = () => z.string({ error: "is required" }).trim().min(1, { error: "is required" });

const envSchema = z.object({
  [BOOT_ENV.host]: z
    .string()
    .trim()
    .min(1, { error: "must not be empty" })
    .optional()
    .default("127.0.0.1"),
  [BOOT_ENV.port]: z
    .string()
    .trim()
    .regex(/^\d+$/, { error: "must be an integer between 1 and 65535" })
    .transform(Number)
    .pipe(
      z
        .number()
        .int()
        .min(1, { error: "must be an integer between 1 and 65535" })
        .max(65535, { error: "must be an integer between 1 and 65535" }),
    )
    .optional()
    .default(3000),
  [BOOT_ENV.databasePath]: required(),
  [BOOT_ENV.encryptionKey]: required()
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, {
      error: `must be base64 (generate one with: openssl rand -base64 ${ENCRYPTION_KEY_BYTES})`,
    })
    .transform((value) => new Uint8Array(Buffer.from(value, "base64")))
    .refine((key) => key.length === ENCRYPTION_KEY_BYTES, {
      error: `must decode to ${ENCRYPTION_KEY_BYTES} bytes (generate one with: openssl rand -base64 ${ENCRYPTION_KEY_BYTES})`,
    }),
});

/** 환경 변수에서 부팅 설정을 읽는다. 문제가 있으면 문제가 있는 변수를 모두 담아 BootConfigError를 던진다. */
export function parseBootConfig(env: Readonly<Record<string, string | undefined>>): BootConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new BootConfigError(
      result.error.issues.map((issue) => ({
        variable: String(issue.path[0] ?? "environment"),
        message: issue.message,
      })),
    );
  }
  const data = result.data;
  return {
    host: data[BOOT_ENV.host],
    port: data[BOOT_ENV.port],
    databasePath: data[BOOT_ENV.databasePath],
    encryptionKey: data[BOOT_ENV.encryptionKey],
  };
}
