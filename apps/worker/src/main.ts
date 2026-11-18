import { bootWorker } from "./boot.js";

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
