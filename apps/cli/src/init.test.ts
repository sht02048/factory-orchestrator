import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BootConfigError, parseBootConfig } from "@factory/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { homePaths, readBootEnv, resolveHome } from "./home.js";
import { EnvFileFormatError, init, renderEnvFile } from "./init.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "factory-cli-init-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("init", () => {
  it("두 번 돌려도 암호화 키가 바뀌지 않는다", () => {
    const home = join(dir, "home");
    const first = init({ home });
    expect(first.created).toBe(true);
    const envFile = homePaths(home).envFile;
    const before = readFileSync(envFile, "utf8");
    const firstKey = readBootEnv(envFile, {})["ENCRYPTION_KEY"];

    const second = init({ home, port: "4000" });
    expect(second).toEqual({ created: false, envFile });
    expect(readFileSync(envFile, "utf8")).toBe(before);
    expect(readBootEnv(envFile, {})["ENCRYPTION_KEY"]).toBe(firstKey);
  });

  it("이미 있으면 주어진 값이 틀려도 검사하지 않고 그대로 둔다", () => {
    const home = join(dir, "home");
    init({ home });
    expect(init({ home, port: "abc" })).toEqual({
      created: false,
      envFile: homePaths(home).envFile,
    });
  });

  it("start가 읽는 규칙으로 통과하는 부팅 설정을 운영자만 읽게 만든다", () => {
    const home = join(dir, "home");
    init({ home });
    const envFile = homePaths(home).envFile;
    expect(statSync(envFile).mode & 0o777).toBe(0o600);

    const config = parseBootConfig(readBootEnv(envFile, {}));
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(3000);
    expect(config.databasePath).toBe(homePaths(home).defaultDatabasePath);
    expect(config.encryptionKey).toHaveLength(32);
    expect(statSync(join(home, "data")).isDirectory()).toBe(true);
  });

  it("키를 매번 새로 뽑는다", () => {
    init({ home: join(dir, "a") });
    init({ home: join(dir, "b") });
    const key = (home: string) => readBootEnv(homePaths(home).envFile, {})["ENCRYPTION_KEY"];
    expect(key(join(dir, "a"))).not.toBe(key(join(dir, "b")));
  });

  it("주어진 바인딩 주소, 포트, 데이터 경로를 쓴다", () => {
    const home = join(dir, "home");
    const databasePath = join(dir, "data with space", "orchestrator.db");
    const result = init({ home, host: "0.0.0.0", port: "4000", databasePath });
    expect(result).toMatchObject({ created: true, host: "0.0.0.0", port: 4000, databasePath });
    const config = parseBootConfig(readBootEnv(homePaths(home).envFile, {}));
    expect(config).toMatchObject({ host: "0.0.0.0", port: 4000, databasePath });
  });

  it("틀린 값이면 파일을 만들지 않는다", () => {
    const home = join(dir, "home");
    expect(() => init({ home, port: "70000" })).toThrow(BootConfigError);
    expect(existsSync(homePaths(home).envFile)).toBe(false);
  });

  it(".env가 그대로 담지 못하는 경로는 거부한다", () => {
    expect(() =>
      renderEnvFile({ DATABASE_PATH: '/data/"quoted".db', ENCRYPTION_KEY: "a" }),
    ).toThrow(EnvFileFormatError);
    expect(() => renderEnvFile({ DATABASE_PATH: "/data/back\\slash.db" })).toThrow(
      EnvFileFormatError,
    );
  });
});

describe("readBootEnv", () => {
  it("셸 환경 변수의 부팅 값이 .env 값을 덮고, 다른 셸 변수는 넣지 않는다", () => {
    const envFile = join(dir, ".env");
    writeFileSync(envFile, 'WEB_PORT="3000"\nDATABASE_PATH="/srv/a.db"\n');
    expect(readBootEnv(envFile, { WEB_PORT: "4000", HOME: "/home/acme" })).toEqual({
      WEB_PORT: "4000",
      DATABASE_PATH: "/srv/a.db",
    });
  });
});

describe("resolveHome", () => {
  it("--home, FACTORY_HOME, 홈 아래 기본 폴더 순으로 고른다", () => {
    expect(resolveHome("/opt/a", { FACTORY_HOME: "/opt/b" }, "/home/acme")).toBe("/opt/a");
    expect(resolveHome(undefined, { FACTORY_HOME: "/opt/b" }, "/home/acme")).toBe("/opt/b");
    expect(resolveHome(undefined, {}, "/home/acme")).toBe("/home/acme/.factory-orchestrator");
  });
});
