import { SecretBox, listTrackerConnections, migrate, openDatabase } from "@factory/db";
import { startWorker } from "@factory/worker";
import { hydrateWorld } from "./hydrate.js";
import { DemoLife } from "./life.js";
import { seedDemo } from "./seed.js";
import { demoWorld } from "./world.js";

/*
 * 개발 진입점의 서버 쪽(티켓 0047). main.ts 가 web 개발 서버(vite)로 이 모듈을 실어 부른다. 워크스페이스 패키지는
 * 소스(.ts)를 내보내 Node 가 바로 읽지 못하기 때문이다. 여기서 DB 를 준비하고(미리 채운 모드면 시드), 가짜 세계를
 * 되살리고, 제품 worker 를 가짜 어댑터 등록표로 같은 프로세스에서 띄운다.
 */

/** 개발용 worker 의 tick 간격. 화면이 빨리 바뀌도록 제품 기본값(10초)보다 짧다 */
const DEV_POLL_INTERVAL_MS = 2_000;
const LIFE_INTERVAL_MS = 2_000;

export type DevMode = "seeded" | "onboarding";

export interface DevStartOptions {
  mode: DevMode;
  databasePath: string;
  encryptionKey: Uint8Array;
  /** 거짓이면 가짜 에이전트가 스스로 움직이지 않는다(개발 화면의 버튼은 그대로 돈다) */
  life: boolean;
}

export interface DevRuntime {
  /** 이번에 시드를 썼는지 */
  seeded: boolean;
  life: DemoLife;
  stop(): Promise<void>;
}

declare global {
  // main.ts 와 개발 화면(plugins.ts)이 vite 모듈 그래프 밖에서 부른다.
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
