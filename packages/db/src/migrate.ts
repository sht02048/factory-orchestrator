import { z } from "zod";
import { inTransaction } from "./database.js";
import type { Database } from "./database.js";
import { sql as initial } from "./migrations/0001-initial.js";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** 순서대로 쌓는다. 이미 배포한 마이그레이션은 고치지 않고 새 버전을 더한다. */
export const MIGRATIONS: ReadonlyArray<Migration> = [{ version: 1, name: "initial", sql: initial }];

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

const versionRow = z.object({ version: z.number().int() });

/**
 * 아직 돌지 않은 마이그레이션을 차례로 돌린다(ADR 0005: 업데이트 때 자동으로 돈다).
 * 여러 번 불러도 안전하다. web과 worker가 함께 띄워도 쓰기 잠금으로 한쪽만 돌린다.
 * DB가 이 코드보다 새 버전이면 거부한다(다운그레이드로 스키마를 잘못 읽지 않게).
 *
 * @returns 이번에 돌린 버전
 */
export function migrate(
  db: Database,
  migrations: ReadonlyArray<Migration> = MIGRATIONS,
  now: Date = new Date(),
): number[] {
  return inTransaction(db, () => {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )`);
    const done = new Set(
      db
        .prepare("SELECT version FROM schema_migrations")
        .all()
        .map((row) => versionRow.parse(row).version),
    );
    const known = new Set(migrations.map((m) => m.version));
    const unknown = [...done].filter((v) => !known.has(v));
    if (unknown.length > 0) {
      throw new MigrationError(
        `database has migrations this version does not know: ${unknown.join(", ")}`,
      );
    }

    const applied: number[] = [];
    const record = db.prepare(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
    );
    for (const migration of migrations.toSorted((a, b) => a.version - b.version)) {
      if (done.has(migration.version)) continue;
      db.exec(migration.sql);
      record.run(migration.version, migration.name, now.getTime());
      applied.push(migration.version);
    }
    return applied;
  });
}
