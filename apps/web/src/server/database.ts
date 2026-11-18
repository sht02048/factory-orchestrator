import { migrate, openDatabase, parseBootConfig } from "@factory/db";
import type { Database } from "@factory/db";

let database: Database | undefined;

export function getDatabase(): Database {
  if (database === undefined) {
    const config = parseBootConfig(process.env);
    const db = openDatabase(config.databasePath);
    migrate(db);
    database = db;
  }
  return database;
}
