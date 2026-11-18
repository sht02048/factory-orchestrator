import { SecretBox, listTrackerConnections, migrate, openDatabase } from "@factory/db";
import { startWorker } from "@factory/worker";
import { hydrateWorld } from "./hydrate.js";
import { DemoLife } from "./life.js";
import { seedDemo } from "./seed.js";
import { demoWorld } from "./world.js";

const DEV_POLL_INTERVAL_MS = 2_000;
const LIFE_INTERVAL_MS = 2_000;

export type DevMode = "seeded" | "onboarding";

export interface DevStartOptions {
  mode: DevMode;
  databasePath: string;
  encryptionKey: Uint8Array;
  life: boolean;
}

export interface DevRuntime {
  seeded: boolean;
  life: DemoLife;
  stop(): Promise<void>;
}

declare global {
  var __factoryDev:
    | { start(options: DevStartOptions): Promise<DevRuntime>; runtime?: DevRuntime }
    | undefined;
}

async function start(options: DevStartOptions): Promise<DevRuntime> {
  const secretBox = new SecretBox(options.encryptionKey);
  const world = demoWorld();
  const db = openDatabase(options.databasePath);
  migrate(db);
  let seeded = false;
  if (options.mode === "seeded" && listTrackerConnections(db, secretBox).length === 0) {
    await seedDemo(db, secretBox, world, new Date());
    seeded = true;
  }
  hydrateWorld(db, world);

  const worker = startWorker({
    dbPath: options.databasePath,
    registry: world.registry(),
    secretBox,
    pollIntervalMs: DEV_POLL_INTERVAL_MS,
  });
  const life = new DemoLife({ db, secretBox, world });
  life.enabled = options.life;
  const timer = setInterval(() => {
    try {
      life.tick();
    } catch (error) {
      console.warn("[dev] fake runner step failed", error);
    }
  }, LIFE_INTERVAL_MS);

  const runtime: DevRuntime = {
    seeded,
    life,
    stop: async () => {
      clearInterval(timer);
      await worker.stop();
      db.$client.close();
    },
  };
  if (globalThis.__factoryDev !== undefined) globalThis.__factoryDev.runtime = runtime;
  return runtime;
}

globalThis.__factoryDev ??= { start };
