import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Database = DatabaseSync;

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
  const db = new DatabaseSync(path, { timeout: BUSY_TIMEOUT_MS });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

let savepointCounter = 0;

/**
 * 쓰기 잠금을 먼저 잡는 트랜잭션(BEGIN IMMEDIATE). 읽고 판단한 뒤 쓰는 일(할당, 마이그레이션)이
 * 다른 프로세스와 엇갈리지 않게 한다. 안에서 던지면 되돌린다.
 * 이미 트랜잭션 안이면 SAVEPOINT로 중첩해, 부르는 쪽이 여러 함수를 한 트랜잭션으로 묶을 수 있다.
 */
export function inTransaction<T>(db: Database, fn: () => T): T {
  const nested = db.isTransaction;
  const savepoint = `tx_${(savepointCounter += 1)}`;
  db.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec(nested ? `RELEASE ${savepoint}` : "COMMIT");
    return result;
  } catch (error) {
    // SQLite가 이미 되돌렸으면 ROLLBACK이 실패한다. 원래 오류를 가리지 않는다.
    if (db.isTransaction) {
      db.exec(nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : "ROLLBACK");
    }
    throw error;
  }
}
