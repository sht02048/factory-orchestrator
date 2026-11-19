import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./database.js";
import type { Database } from "./database.js";
import { MigrationError, checkSchema, loadMigrations, migrate } from "./migrate.js";
import { seededDatabase, tempDatabasePath } from "./test-fixtures.js";

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
        "run_cancel_requests",
        "run_permission_waits",
        "run_questions",
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

  it("테이블을 다시 만드는 마이그레이션(drizzle-kit 방식)이 자식 행을 지우지 않는다", () => {
    const db = seededDatabase();
    const children = () =>
      db.$client.prepare("SELECT count(*) AS n FROM workspace_tracker_projects").get()?.["n"];
    expect(children()).toBe(1);

    const recreate = {
      name: "99990101000000_recreate_workspaces",
      hash: "recreate",
      sql: [
        "PRAGMA foreign_keys=OFF",
        `CREATE TABLE __new_workspaces (
          id text PRIMARY KEY, name text NOT NULL,
          max_run_ms integer DEFAULT 7200000 NOT NULL, created_at integer NOT NULL)`,
        "INSERT INTO __new_workspaces SELECT id, name, max_run_ms, created_at FROM workspaces",
        "DROP TABLE workspaces",
        "ALTER TABLE __new_workspaces RENAME TO workspaces",
        "PRAGMA foreign_keys=ON",
      ],
    };
    expect(migrate(db, [...loadMigrations(), recreate])).toEqual([recreate.name]);
    expect(children()).toBe(1);
    expect(db.$client.prepare("PRAGMA foreign_keys").get()?.["foreign_keys"]).toBe(1);
  });

  it("외래 키를 어기는 마이그레이션은 되돌린다", () => {
    const db = seededDatabase();
    const orphan = {
      name: "99990101000000_orphan",
      hash: "orphan",
      sql: ["DELETE FROM workspaces"],
    };
    expect(() => migrate(db, [...loadMigrations(), orphan])).toThrow(/foreign key/);
    expect(db.$client.prepare("SELECT count(*) AS n FROM workspaces").get()?.["n"]).toBe(1);
    expect(db.$client.prepare("PRAGMA foreign_keys").get()?.["foreign_keys"]).toBe(1);
  });

  it("0064 마이그레이션이 기존 런·러너를 남긴 채 제목과 Offline 시각 칸을 비워 더한다", () => {
    const db = openDatabase(":memory:");
    const all = loadMigrations();
    const added = all.findIndex((m) => m.name.endsWith("_run_title_offline_since"));
    expect(added).toBeGreaterThan(0);
    migrate(db, all.slice(0, added));
    db.$client.exec(`
      INSERT INTO tracker_connections (id, kind, name, secrets, created_at) VALUES ('c', 'fake', 'c', '{}', 0);
      INSERT INTO workspaces (id, name, created_at) VALUES ('w', 'w', 0);
      INSERT INTO runners (id, kind, name, capacity, online, checked_at, created_at)
        VALUES ('r', 'fake', 'r', 1, 0, 5, 0);
      INSERT INTO runs (id, tracker_connection_id, ticket_key, workspace_id, tracker_project_id,
        runner_project_id, agent_id, worktree_name, state, runner_id, assigned_at)
        VALUES ('queued', 'c', 'ENG-1', 'w', 'tp', 'rp', 'a', 'ganger-ENG-1-1', 'queued', 'r', 1);
    `);

    expect(migrate(db)).toEqual(all.slice(added).map((m) => m.name));
    expect(
      db.$client.prepare("SELECT id, ticket_key, ticket_title, state FROM runs").all(),
    ).toEqual([{ id: "queued", ticket_key: "ENG-1", ticket_title: null, state: "queued" }]);
    expect(
      db.$client.prepare("SELECT id, online, checked_at, offline_since FROM runners").all(),
    ).toEqual([{ id: "r", online: 0, checked_at: 5, offline_since: null }]);
  });

  it("0086 마이그레이션이 기존 러너를 남긴 채 공급자 사용량 칸을 비워 더한다", () => {
    const db = openDatabase(":memory:");
    const all = loadMigrations();
    const added = all.findIndex((m) => m.name.endsWith("_runner_provider_usage"));
    expect(added).toBeGreaterThan(0);
    migrate(db, all.slice(0, added));
    db.$client.exec(`
      INSERT INTO tracker_connections (id, kind, name, secrets, created_at) VALUES ('c', 'fake', 'c', '{}', 0);
      INSERT INTO workspaces (id, name, created_at) VALUES ('w', 'w', 0);
      INSERT INTO runners (id, kind, name, capacity, online, prerequisites, checked_at, offline_since, created_at)
        VALUES ('r', 'fake', 'r', 2, 1, '[]', 5, NULL, 0);
      INSERT INTO runner_projects (runner_id, project_id, display_name, setup_state)
        VALUES ('r', 'rp', 'rp', 'ready');
      INSERT INTO runs (id, tracker_connection_id, ticket_key, workspace_id, tracker_project_id,
        runner_project_id, agent_id, worktree_name, state, runner_id, assigned_at)
        VALUES ('queued', 'c', 'ENG-1', 'w', 'tp', 'rp', 'a', 'ganger-ENG-1-1', 'queued', 'r', 1);
    `);

    expect(migrate(db)).toEqual(all.slice(added).map((m) => m.name));
    expect(
      db.$client
        .prepare(
          "SELECT id, capacity, online, prerequisites, checked_at, provider_usage, provider_usage_read_at FROM runners",
        )
        .all(),
    ).toEqual([
      {
        id: "r",
        capacity: 2,
        online: 1,
        prerequisites: "[]",
        checked_at: 5,
        provider_usage: null,
        provider_usage_read_at: null,
      },
    ]);
    expect(db.$client.prepare("SELECT count(*) AS n FROM runner_projects").get()?.["n"]).toBe(1);
    expect(db.$client.prepare("SELECT runner_id FROM runs").all()).toEqual([{ runner_id: "r" }]);
  });

  it("0037 마이그레이션이 옛 런을 결정적 워크트리 이름·실제 브랜치·완료 보고 결과로 옮긴다", () => {
    const db = openDatabase(":memory:");
    const all = loadMigrations();
    const before = all.findIndex((m) => m.name.endsWith("_core_contracts"));
    expect(before).toBeGreaterThan(0);
    migrate(db, all.slice(0, before));
    db.$client.exec(`
      INSERT INTO tracker_connections (id, kind, name, secrets, created_at) VALUES ('c', 'fake', 'c', '{}', 0);
      INSERT INTO workspaces (id, name, created_at) VALUES ('w', 'w', 0);
      INSERT INTO runners (id, kind, name, capacity, created_at) VALUES ('r', 'fake', 'r', 1, 0);
      INSERT INTO runs (id, tracker_connection_id, ticket_key, workspace_id, tracker_project_id,
        runner_project_id, agent_id, branch, state, runner_id, assigned_at)
        VALUES ('queued', 'c', 'ENG-1', 'w', 'tp', 'rp', 'a', 'factory/ENG-1-1', 'queued', NULL, 1);
      UPDATE runs SET retry_token = 'op-1' WHERE id = 'queued';
      INSERT INTO runs (id, tracker_connection_id, ticket_key, workspace_id, tracker_project_id,
        runner_project_id, agent_id, branch, state, runner_id, assigned_at, started_at, ended_at,
        worktree_ref, agent_result, pr_state)
        VALUES ('ended', 'c', 'ENG-2', 'w', 'tp', 'rp', 'a', 'factory/ENG-2-1', 'ended', 'r', 1, 2, 3,
          'repo::/wt', 'exited-with-error', 'open');
    `);

    migrate(db);
    const rows = db.$client
      .prepare(
        "SELECT id, worktree_name, branch, agent_ref, agent_result, runner_unreached, start_requested_at FROM runs ORDER BY id",
      )
      .all();
    expect(rows).toEqual([
      {
        id: "ended",
        worktree_name: "factory-ENG-2-1",
        branch: "factory/ENG-2-1",
        agent_ref: "repo::/wt",
        agent_result: "reported-failure",
        runner_unreached: 0,
        start_requested_at: null,
      },
      {
        id: "queued",
        worktree_name: "factory-ENG-1-1",
        branch: null,
        agent_ref: null,
        agent_result: null,
        runner_unreached: 0,
        start_requested_at: 1,
      },
    ]);
  });
});

describe("checkSchema", () => {
  it("마이그레이션을 돌리지 않은 DB는 뒤처졌다고 알리고 아무것도 만들지 않는다", () => {
    const db = openDatabase(":memory:");
    expect(checkSchema(db)).toEqual({
      kind: "behind",
      missing: loadMigrations().map((m) => m.name),
    });
    expect(schemaDump(db)).toEqual([]);
  });

  it("모든 마이그레이션을 적용한 DB는 지금 판이다", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    expect(checkSchema(db)).toEqual({ kind: "current" });
  });

  it("마지막 마이그레이션이 빠졌으면 뒤처졌다고 알린다", () => {
    const db = openDatabase(":memory:");
    const all = loadMigrations();
    migrate(db, all.slice(0, -1));
    expect(checkSchema(db, all)).toEqual({ kind: "behind", missing: [all.at(-1)?.name] });
  });

  it("모르는 마이그레이션이 있으면 앞섰다고 알린다", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    db.$client
      .prepare(
        "INSERT INTO schema_migrations (name, hash, applied_at) VALUES ('99990101000000_future', 'x', 0)",
      )
      .run();
    expect(checkSchema(db)).toEqual({ kind: "ahead", unknown: ["99990101000000_future"] });
  });

  it("적용한 마이그레이션의 SQL이 바뀌었으면 고쳐졌다고 알린다", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const edited = loadMigrations().map((m) => ({ ...m, hash: `${m.hash}-edited` }));
    expect(checkSchema(db, edited)).toEqual({
      kind: "edited",
      changed: edited.map((m) => m.name),
    });
  });
});
