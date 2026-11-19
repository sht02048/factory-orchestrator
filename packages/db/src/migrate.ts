import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { z } from "zod";
import { inTransaction } from "./database.js";
import type { Database } from "./database.js";

export interface Migration {
  name: string;
  hash: string;
  sql: ReadonlyArray<string>;
}

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

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

export function migrate(
  db: Database,
  migrations: ReadonlyArray<Migration> = loadMigrations(),
  now: Date = new Date(),
): string[] {
  const client = db.$client;
  if (client.isTransaction) {
    throw new MigrationError("migrate() must not run inside a transaction");
  }
  const foreignKeys = client.prepare("PRAGMA foreign_keys").get()?.["foreign_keys"] === 1;
  client.exec("PRAGMA foreign_keys = OFF");
  try {
    return runPending(db, migrations, now);
  } finally {
    if (foreignKeys) client.exec("PRAGMA foreign_keys = ON");
  }
}

function runPending(db: Database, migrations: ReadonlyArray<Migration>, now: Date): string[] {
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
    const violations = client.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      throw new MigrationError(
        `migrations left ${violations.length} foreign key violation(s): ${JSON.stringify(violations.slice(0, 5))}`,
      );
    }
    return ran;
  });
}

export type SchemaCheck =
  | { kind: "current" }
  | { kind: "behind"; missing: string[] }
  | { kind: "ahead"; unknown: string[] }
  | { kind: "edited"; changed: string[] };

export function checkSchema(
  db: Database,
  migrations: ReadonlyArray<Migration> = loadMigrations(),
): SchemaCheck {
  const client = db.$client;
  const table = client
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  const applied = new Map(
    table === undefined
      ? []
      : client
          .prepare("SELECT name, hash FROM schema_migrations")
          .all()
          .map((raw) => {
            const row = appliedRow.parse(raw);
            return [row.name, row.hash] as const;
          }),
  );
  const known = new Map(migrations.map((m) => [m.name, m.hash]));
  const unknown = [...applied.keys()].filter((name) => !known.has(name));
  if (unknown.length > 0) return { kind: "ahead", unknown };
  const changed = [...applied].filter(([name, hash]) => known.get(name) !== hash);
  if (changed.length > 0) return { kind: "edited", changed: changed.map(([name]) => name) };
  const missing = migrations.map((m) => m.name).filter((name) => !applied.has(name));
  if (missing.length > 0) return { kind: "behind", missing };
  return { kind: "current" };
}
