import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { z } from "zod";
import { inTransaction } from "./database.js";
import type { Database } from "./database.js";

/** drizzle-kit이 만든 마이그레이션 하나(`drizzle/<시각>_<이름>/migration.sql`) */
export interface Migration {
  /** 폴더 이름. 시각으로 시작해 순서를 정한다 */
  name: string;
  /** SQL 파일의 해시. 이미 적용한 마이그레이션을 고쳤는지 본다 */
  hash: string;
  /** `--> statement-breakpoint`로 나눈 문장 */
  sql: ReadonlyArray<string>;
}

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

/** 이 패키지에 든 마이그레이션. 이미 배포한 것은 고치지 않고 `db:generate`로 새로 더한다. */
export function loadMigrations(folder: string = MIGRATIONS_FOLDER): Migration[] {
  return readMigrationFiles({ migrationsFolder: folder })
    .toSorted((a, b) => a.folderMillis - b.folderMillis || a.name.localeCompare(b.name))
    .map((m) => ({ name: m.name, hash: m.hash, sql: m.sql }));
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

const appliedRow = z.object({ name: z.string(), hash: z.string() });

/**
 * 아직 돌지 않은 마이그레이션을 차례로 돌린다(ADR 0005: 업데이트 때 자동으로 돈다).
 *
 * - 여러 번 불러도 안전하다. 적용한 것은 `schema_migrations`에 이름과 해시로 남긴다.
 * - 한 번에 돌리는 마이그레이션 전부가 BEGIN IMMEDIATE 하나 안에서 돈다. 하나라도 실패하면 아무것도
 *   남기지 않고, web과 worker가 함께 띄워도 쓰기 잠금으로 한쪽만 돌린다.
 * - DB에 이 코드가 모르는 마이그레이션이 있으면(다운그레이드) 거부한다. 이미 적용한 마이그레이션의
 *   SQL이 바뀌었어도 거부한다.
 *
 * Drizzle의 migrate()는 BEGIN(지연 잠금)을 쓰고 다운그레이드를 막지 않아 쓰지 않는다.
 *
 * @returns 이번에 돌린 마이그레이션 이름
 */
export function migrate(
  db: Database,
  migrations: ReadonlyArray<Migration> = loadMigrations(),
  now: Date = new Date(),
): string[] {
  const client = db.$client;
  return inTransaction(db, () => {
    client.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )`);
    const applied = new Map(
      client
        .prepare("SELECT name, hash FROM schema_migrations")
        .all()
        .map((raw) => {
          const row = appliedRow.parse(raw);
          return [row.name, row.hash] as const;
        }),
    );
    const known = new Map(migrations.map((m) => [m.name, m.hash]));

    const unknown = [...applied.keys()].filter((name) => !known.has(name));
    if (unknown.length > 0) {
      throw new MigrationError(
        `database has migrations this version does not know: ${unknown.join(", ")}`,
      );
    }
    const changed = [...applied].filter(([name, hash]) => known.get(name) !== hash);
    if (changed.length > 0) {
      throw new MigrationError(
        `applied migrations were edited: ${changed.map(([name]) => name).join(", ")}`,
      );
    }

    const ran: string[] = [];
    const record = client.prepare(
      "INSERT INTO schema_migrations (name, hash, applied_at) VALUES (?, ?, ?)",
    );
    for (const migration of migrations) {
      if (applied.has(migration.name)) continue;
      for (const statement of migration.sql) {
        if (statement.trim().length > 0) client.exec(statement);
      }
      record.run(migration.name, migration.hash, now.getTime());
      ran.push(migration.name);
    }
    return ran;
  });
}
