import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BundleMigrationsError,
  MIGRATIONS_FROM_MODULE,
  migrationOutputs,
} from "./bundle-migrations.js";
import { MIGRATIONS_FOLDER, loadMigrations } from "./migrate.js";

const MIGRATE_MODULE = fileURLToPath(new URL("./migrate.ts", import.meta.url));

describe("migrationOutputs", () => {
  it("migrate.ts와 같은 상대 경로로 마이그레이션 폴더를 찾는다", () => {
    expect(fileURLToPath(new URL(MIGRATIONS_FROM_MODULE, import.meta.url))).toBe(MIGRATIONS_FOLDER);
  });

  it("migrate.ts가 든 청크 기준으로 모든 마이그레이션 SQL을 내보낸다", () => {
    const outputs = migrationOutputs({
      "server.js": { type: "chunk", fileName: "server.js", moduleIds: [] },
      "assets/database-abc.js": {
        type: "chunk",
        fileName: "assets/database-abc.js",
        moduleIds: ["/elsewhere/a.ts", MIGRATE_MODULE],
      },
      "assets/app.css": { type: "asset" },
    });
    expect(outputs.map((o) => o.fileName)).toEqual(
      loadMigrations().map((m) => `drizzle/${m.name}/migration.sql`),
    );
  });

  it("migrate.ts가 없는 번들(브라우저)에는 아무것도 내보내지 않는다", () => {
    expect(
      migrationOutputs({ "index.js": { type: "chunk", fileName: "index.js", moduleIds: [] } }),
    ).toEqual([]);
  });

  it("산출물 폴더 밖으로 나가야 하면 빌드를 멈춘다", () => {
    expect(() =>
      migrationOutputs({
        "server.js": { type: "chunk", fileName: "server.js", moduleIds: [MIGRATE_MODULE] },
      }),
    ).toThrow(BundleMigrationsError);
  });
});
