import { exitOnFatal, log, processStartFields, setupProcessLog } from "@ganger/log";

let started = false;

export function startWebLog(env: Readonly<Record<string, string | undefined>>): void {
  if (started) return;
  started = true;
  setupProcessLog({ proc: "web", env });
  exitOnFatal(process, log, (code) => process.exit(code));
  log().info("process.started", processStartFields());
  process.once("exit", () => log().info("process.stopped"));
}
