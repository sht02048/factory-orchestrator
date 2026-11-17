import { migrate, openDatabase, parseBootConfig } from "@factory/db";
import type { Database } from "@factory/db";

let database: Database | undefined;

/**
 * web 이 읽는 SQLite 연결(ADR 0002). 처음 부를 때 부팅 설정(환경 변수)으로 열고 마이그레이션을 돌린다.
 * 마이그레이션은 여러 번 돌려도 안전하고, worker 와 함께 떠도 쓰기 잠금으로 한쪽만 돌린다(packages/db migrate).
 * server function 안에서만 부른다.
 */
export function getDatabase(): Database {
  if (database === undefined) {
    const config = parseBootConfig(process.env);
    const db = openDatabase(config.databasePath);
    migrate(db);
    database = db;
  }
  return database;
}
