import { bootWorker } from "./boot.js";

/*
 * worker 데몬 진입점(`pnpm --filter @factory/worker start`). 부팅 설정은 셸 환경 변수로 받는다(ADR 0005).
 * SIGINT·SIGTERM을 받으면 돌던 tick을 마치고 DB를 닫은 뒤 끝낸다.
 */
const { migrated, worker } = bootWorker({ env: process.env });
console.info(
  migrated.length === 0
    ? "[worker] started"
    : `[worker] applied ${migrated.length} migration(s) and started`,
);

let stopping = false;
const stop = (signal: NodeJS.Signals): void => {
  if (stopping) return;
  stopping = true;
  console.info(`[worker] ${signal} received, stopping`);
  worker.stop().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error("[worker] could not stop cleanly", error);
      process.exit(1);
    },
  );
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
