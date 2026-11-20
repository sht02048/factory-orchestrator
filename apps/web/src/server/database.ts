import { log } from "@ganger/log";
import { migrate, openDatabase, parseBootConfig, pruneChangeEvents } from "@ganger/db";
import type { Database } from "@ganger/db";

export const CHANGE_PRUNE_INTERVAL_MS = 60 * 60_000;

let database: Database | undefined;

export function getDatabase(): Database {
  if (database === undefined) {
    const config = parseBootConfig(process.env);
    const db = openDatabase(config.databasePath);
    migrate(db);
    startChangePruning(db);
    database = db;
  }
  return database;
}

export function startChangePruning(
  db: Database,
  options: { intervalMs?: number; now?: () => Date } = {},
): () => void {
  const now = options.now ?? (() => new Date());
  const prune = () => {
    try {
      pruneChangeEvents(db, now());
    } catch (error) {
      log().warn("change_events.prune_failed", { error });
    }
  };
  prune();
  const timer = setInterval(prune, options.intervalMs ?? CHANGE_PRUNE_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
