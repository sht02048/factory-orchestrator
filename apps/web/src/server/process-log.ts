import {
  exitOnFatal,
  log,
  processStartFields,
  setupProcessLog,
  useConsoleLogger,
} from "@ganger/log";

let started = false;

export function startWebLog(env: Readonly<Record<string, string | undefined>>): void {
  if (started) return;
  started = true;
  setupProcessLog({ proc: "web", env });
  let crashed = false;
  exitOnFatal(process, log, (code) => {
    crashed = true;
    process.exit(code);
  });
  log().info("process.started", processStartFields());
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => log().info("process.stopping", { signal }));
  }
  process.once("exit", () => {
    if (!crashed) log().info("process.stopped");
  });
}

export function useWebConsoleLog(): void {
  useConsoleLogger("web");
}
