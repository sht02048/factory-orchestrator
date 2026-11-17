import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";

/**
 * Drizzle 연결. 쿼리는 스키마(schema.ts)로 타입 검사를 받는다. 원본 node:sqlite 연결은 `$client`다.
 * 드라이버는 Node 내장 node:sqlite라 네이티브 빌드가 없다.
 */
export type Database = NodeSQLiteDatabase & { $client: DatabaseSync };

/** SQLite가 SQLITE_BUSY를 내기 전에 잠금을 기다리는 시간. web과 worker가 같은 파일을 쓴다. */
const BUSY_TIMEOUT_MS = 5000;

/**
 * web과 worker가 함께 쓰는 SQLite 파일을 연다(ADR 0002). WAL과 외래 키를 켠다.
 * 부모 디렉터리가 없으면 만든다. 테스트는 `:memory:`를 줄 수 있다.
 * 마이그레이션은 따로 `migrate`로 돌린다.
 */
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

/**
 * 쓰기 잠금을 먼저 잡는 트랜잭션(BEGIN IMMEDIATE). 읽고 판단한 뒤 쓰는 일(할당, 마이그레이션)이
 * 다른 프로세스와 엇갈리지 않게 한다. 안에서 던지면 되돌린다.
 * 이미 트랜잭션 안이면 SAVEPOINT로 중첩해, 부르는 쪽이 여러 함수를 한 트랜잭션으로 묶을 수 있다.
 *
 * Drizzle의 `db.transaction`은 트랜잭션 객체를 따로 넘겨야 해서 접근 함수가 `db`를 그대로 쓰지
 * 못한다. 연결 하나에서 동기로 돌므로 원본 연결에 직접 BEGIN을 걸고 같은 `db`로 쿼리한다.
 */
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
    // SQLite가 이미 되돌렸으면 ROLLBACK이 실패한다. 원래 오류를 가리지 않는다.
    if (client.isTransaction) {
      client.exec(nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : "ROLLBACK");
    }
    throw error;
  }
}
