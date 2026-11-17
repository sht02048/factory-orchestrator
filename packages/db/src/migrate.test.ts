import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./database.js";
import type { Database } from "./database.js";
import { MigrationError, loadMigrations, migrate } from "./migrate.js";
import { tempDatabasePath } from "./test-fixtures.js";

function schemaDump(db: Database): unknown[] {
  return db.$client.prepare("SELECT type, name, sql FROM sqlite_schema ORDER BY type, name").all();
}

describe("migrate", () => {
  let cleanup: () => void = () => {};
  afterEach(() => cleanup());

  it("빈 파일에서 스키마를 만들고, 다시 돌려도 스키마가 바뀌지 않는다", () => {
    const temp = tempDatabasePath();
    cleanup = temp.cleanup;

    const db = openDatabase(temp.path);
    const migrations = loadMigrations();
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrate(db)).toEqual(migrations.map((m) => m.name));
    const tables = db.$client
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row["name"]);
    expect(tables).toEqual(
      expect.arrayContaining([
        "auto_assign_labels",
        "code_host_connections",
        "log_tail_requests",
        "mappings",
        "run_state_changes",
        "runner_check_requests",
        "runner_projects",
        "runners",
        "runs",
        "schema_migrations",
        "tracker_connections",
        "tracker_events",
        "workspace_tracker_projects",
        "workspaces",
      ]),
    );
    const first = schemaDump(db);

    expect(migrate(db)).toEqual([]);
    expect(schemaDump(db)).toEqual(first);
    db.$client.close();

    // 다른 연결(다른 프로세스가 다시 띄운 경우)에서 돌려도 같다.
    const again = openDatabase(temp.path);
    expect(migrate(again)).toEqual([]);
    expect(schemaDump(again)).toEqual(first);
    again.$client.close();
  });

  it("WAL과 외래 키를 켠다", () => {
    const temp = tempDatabasePath();
    cleanup = temp.cleanup;
    const db = openDatabase(temp.path);
    expect(db.$client.prepare("PRAGMA journal_mode").get()?.["journal_mode"]).toBe("wal");
    expect(db.$client.prepare("PRAGMA foreign_keys").get()?.["foreign_keys"]).toBe(1);
    db.$client.close();
  });

  it("이 코드가 모르는 마이그레이션이 DB에 있으면(다운그레이드) 거부한다", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    db.$client
      .prepare(
        "INSERT INTO schema_migrations (name, hash, applied_at) VALUES ('99990101000000_future', 'x', 0)",
      )
      .run();
    expect(() => migrate(db)).toThrow(MigrationError);
  });

  it("이미 적용한 마이그레이션의 SQL이 바뀌었으면 거부한다", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const edited = loadMigrations().map((m) => ({ ...m, hash: `${m.hash}-edited` }));
    expect(() => migrate(db, edited)).toThrow(/edited/);
  });

  it("마이그레이션이 실패하면 아무것도 남기지 않는다", () => {
    const db = openDatabase(":memory:");
    const broken = [
      ...loadMigrations(),
      {
        name: "99990101000000_broken",
        hash: "broken",
        sql: ["CREATE TABLE extra (id TEXT)", "SELECT * FROM missing"],
      },
    ];
    expect(() => migrate(db, broken)).toThrow(/no such table: missing/);
    expect(
      db.$client.prepare("SELECT name FROM sqlite_schema WHERE name IN ('runs', 'extra')").get(),
    ).toBeUndefined();
    expect(migrate(db)).toEqual(loadMigrations().map((m) => m.name));
  });
});
