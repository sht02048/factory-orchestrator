import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";

export type Database = NodeSQLiteDatabase & { $client: DatabaseSync };

const BUSY_TIMEOUT_MS = 5000;

export function openDatabase(path: string): Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const client = new DatabaseSync(path, { timeout: BUSY_TIMEOUT_MS });
  client.exec("PRAGMA journal_mode = WAL");
  client.exec("PRAGMA synchronous = NORMAL");
  client.exec("PRAGMA foreign_keys = ON");
  return drizzle({ client });
}

let savepointCounter = 0;

export function inTransaction<T>(db: Database, fn: () => T): T {
  const client = db.$client;
  const nested = client.isTransaction;
  const savepoint = `tx_${(savepointCounter += 1)}`;
  client.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
  try {
    const result = fn();
    client.exec(nested ? `RELEASE ${savepoint}` : "COMMIT");
    return result;
  } catch (error) {
    if (client.isTransaction) {
      client.exec(nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : "ROLLBACK");
    }
    throw error;
  }
}
