import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry } from "@ganger/core";
import { BootConfigError, loadMigrations, openDatabase } from "@ganger/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootWorker } from "./boot.js";
import { createAdapterRegistry } from "./registry.js";

const key = Buffer.alloc(32, 5).toString("base64");
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "factory-worker-boot-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("bootWorker", () => {
  it("띄우기 전에 마이그레이션을 돌리고, 다시 띄우면 돌릴 것이 없다 (ADR 0005)", async () => {
    const env = { DATABASE_PATH: join(dir, "data", "factory.db"), ENCRYPTION_KEY: key };
    const quiet = { warn: () => undefined };
    const first = bootWorker({ env, registry: new AdapterRegistry(), logger: quiet });
    expect(first.migrated).toEqual(loadMigrations().map((m) => m.name));
    await first.worker.stop();

    const db = openDatabase(env.DATABASE_PATH);
    const applied = db.$client.prepare("SELECT name FROM schema_migrations").all();
    db.$client.close();
    expect(applied).toHaveLength(loadMigrations().length);

    const second = bootWorker({ env, registry: new AdapterRegistry(), logger: quiet });
    expect(second.migrated).toEqual([]);
    await second.worker.stop();
  });

  it("부팅 설정이 틀리면 DB를 열기 전에 실패한다", () => {
    expect(() =>
      bootWorker({ env: { DATABASE_PATH: "relative.db", ENCRYPTION_KEY: key } }),
    ).toThrow(BootConfigError);
  });
});

describe("createAdapterRegistry", () => {
  it("Orca 러너, Linear 트래커, GitHub 코드 호스트를 종류로 고른다 (ADR 0008)", () => {
    expect(createAdapterRegistry().kinds()).toEqual({
      runners: ["orca"],
      trackers: ["linear"],
      codeHosts: ["github"],
    });
  });
});
