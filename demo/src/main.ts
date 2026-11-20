import { startDevServer } from "./server.ts";

const server = await startDevServer(process.argv.slice(2));

let stopping = false;
const stop = (signal: NodeJS.Signals): void => {
  if (stopping) return;
  stopping = true;
  console.info(`[dev] ${signal} received, stopping`);
  server.stop().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error("[dev] could not stop cleanly", error);
      process.exit(1);
    },
  );
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
