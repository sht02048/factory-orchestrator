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

const afterCommit = new WeakMap<DatabaseSync, Array<() => void>>();

export function onCommit(db: Database, fn: () => void): void {
  const pending = db.$client.isTransaction ? afterCommit.get(db.$client) : undefined;
  if (pending === undefined) {
    fn();
    return;
  }
  pending.push(fn);
}

export function inTransaction<T>(db: Database, fn: () => T): T {
  const client = db.$client;
  const nested = client.isTransaction;
  const savepoint = `tx_${(savepointCounter += 1)}`;
  const pending = nested ? (afterCommit.get(client) ?? []) : [];
  const pendingBefore = pending.length;
  client.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
  if (!nested) afterCommit.set(client, pending);
  try {
    const result = fn();
    client.exec(nested ? `RELEASE ${savepoint}` : "COMMIT");
    if (!nested) runAfterCommit(client, pending);
    return result;
  } catch (error) {
    if (client.isTransaction) {
      client.exec(nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : "ROLLBACK");
    }
    if (nested) pending.length = pendingBefore;
    else afterCommit.delete(client);
    throw error;
  }
}

function runAfterCommit(client: DatabaseSync, pending: ReadonlyArray<() => void>): void {
  afterCommit.delete(client);
  for (const fn of pending) {
    try {
      fn();
    } catch {
      continue;
    }
  }
}
