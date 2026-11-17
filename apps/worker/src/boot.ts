import { SecretBox, migrate, openDatabase, parseBootConfig } from "@factory/db";
import type { AdapterRegistry } from "@factory/core";
import { createAdapterRegistry } from "./registry.js";
import { startWorker } from "./worker.js";
import type { RunningWorker, WorkerLogger } from "./worker.js";

/**
 * tick 사이에 쉬는 시간. 런 진행은 바퀴마다 러너에 묻고, 러너 확인·PR 폴링·폴링 보정은 각자 간격
 * (runner-check.ts, after-run.ts, auto-assign.ts)을 따로 지켜 이보다 드물게 돈다.
 */
export const POLL_INTERVAL_MS = 10_000;

export interface BootOptions {
  /** 부팅 설정을 읽을 환경 변수(ADR 0005). `DATABASE_PATH`와 `ENCRYPTION_KEY`가 필요하다. */
  env: Readonly<Record<string, string | undefined>>;
  /** 시험에서 가짜 어댑터를 넣는다. 없으면 실제 어댑터 등록표를 쓴다. */
  registry?: AdapterRegistry;
  pollIntervalMs?: number;
  logger?: WorkerLogger;
}

/**
 * 환경 변수로 worker를 띄운다. 띄우기 전에 마이그레이션을 돌린다(ADR 0005: 업데이트 때 자동으로 돈다).
 * 마이그레이션은 여러 번 돌려도 안전하고 web과 함께 떠도 쓰기 잠금으로 한쪽만 돌린다(packages/db migrate).
 *
 * @returns 이번에 돌린 마이그레이션 이름과 돌고 있는 worker
 */
export function bootWorker(options: BootOptions): { migrated: string[]; worker: RunningWorker } {
  const config = parseBootConfig(options.env);
  const db = openDatabase(config.databasePath);
  let migrated: string[];
  try {
    migrated = migrate(db);
  } finally {
    db.$client.close();
  }
  const worker = startWorker({
    dbPath: config.databasePath,
    registry: options.registry ?? createAdapterRegistry(),
    secretBox: new SecretBox(config.encryptionKey),
    pollIntervalMs: options.pollIntervalMs ?? POLL_INTERVAL_MS,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
  return { migrated, worker };
}
