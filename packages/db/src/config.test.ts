import { describe, expect, it } from "vitest";
import { BootConfigError, parseBootConfig } from "./config.js";

const VALID_KEY = Buffer.alloc(32, 1).toString("base64");

function issuesOf(env: Record<string, string | undefined>): Array<{ variable: string }> {
  try {
    parseBootConfig(env);
  } catch (error) {
    if (error instanceof BootConfigError) return [...error.issues];
    throw error;
  }
  throw new Error("parseBootConfig did not fail");
}

describe("parseBootConfig", () => {
  it("넷을 읽고, 바인딩 주소와 포트는 기본값이 있다", () => {
    const config = parseBootConfig({ DATABASE_PATH: "/data/f.db", ENCRYPTION_KEY: VALID_KEY });
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(3000);
    expect(config.databasePath).toBe("/data/f.db");
    expect(config.encryptionKey).toEqual(new Uint8Array(32).fill(1));
  });

  it("준 값을 쓴다", () => {
    const config = parseBootConfig({
      WEB_HOST: "0.0.0.0",
      WEB_PORT: "4000",
      DATABASE_PATH: "/var/lib/f.db",
      ENCRYPTION_KEY: VALID_KEY,
    });
    expect(config).toMatchObject({ host: "0.0.0.0", port: 4000, databasePath: "/var/lib/f.db" });
  });

  it("필수 값이 빠지면 어느 값인지 알린다", () => {
    expect(issuesOf({})).toEqual([
      expect.objectContaining({ variable: "DATABASE_PATH" }),
      expect.objectContaining({ variable: "ENCRYPTION_KEY" }),
    ]);
    expect(issuesOf({ DATABASE_PATH: "  ", ENCRYPTION_KEY: VALID_KEY })).toEqual([
      expect.objectContaining({ variable: "DATABASE_PATH" }),
    ]);
  });

  it.each([
    ["WEB_PORT", { WEB_PORT: "abc" }],
    ["WEB_PORT", { WEB_PORT: "0" }],
    ["WEB_PORT", { WEB_PORT: "70000" }],
    ["WEB_HOST", { WEB_HOST: "" }],
    ["DATABASE_PATH", { DATABASE_PATH: "./data/f.db" }],
    ["ENCRYPTION_KEY", { ENCRYPTION_KEY: "not base64!" }],
    ["ENCRYPTION_KEY", { ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") }],
  ])("형식이 틀린 %s를 알린다", (variable, override) => {
    const env = { DATABASE_PATH: "/f.db", ENCRYPTION_KEY: VALID_KEY, ...override };
    expect(issuesOf(env)).toEqual([expect.objectContaining({ variable })]);
  });

  it("오류 메시지에 암호화 키 값을 넣지 않는다", () => {
    const badKey = Buffer.alloc(16, 5).toString("base64");
    const parse = () => parseBootConfig({ DATABASE_PATH: "/f.db", ENCRYPTION_KEY: badKey });
    expect(parse).toThrow(BootConfigError);
    expect(parse).toThrow(/ENCRYPTION_KEY/);
    expect(parse).not.toThrow(badKey);
  });
});
