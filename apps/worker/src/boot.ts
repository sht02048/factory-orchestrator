import { SecretBox, migrate, openDatabase, parseBootConfig } from "@factory/db";
import type { AdapterRegistry } from "@factory/core";
import { createAdapterRegistry } from "./registry.js";
import { startWorker } from "./worker.js";
import type { RunningWorker, WorkerLogger } from "./worker.js";

export const POLL_INTERVAL_MS = 10_000;

export interface BootOptions {
  env: Readonly<Record<string, string | undefined>>;
  registry?: AdapterRegistry;
  pollIntervalMs?: number;
  logger?: WorkerLogger;
}

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
