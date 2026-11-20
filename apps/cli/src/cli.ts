import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { exitOnFatal, log, setupProcessLog } from "@ganger/log";
import { HOME_ENV } from "./home.js";
import { caffeinate } from "./keep-awake.js";
import { appLayout } from "./layout.js";
import { runCommand, runProgram } from "./program.js";
import { PRODUCT_VERSION } from "./version.js";

const entry = process.argv[1];
process.exitCode = await runProgram(process.argv.slice(2), {
  env: process.env,
  platform: process.platform,
  userHome: homedir(),
  uid: process.getuid?.() ?? 0,
  nodePath: process.execPath,
  cliEntry: entry === undefined ? "" : realpathSync(entry),
  layout: appLayout(),
  runCommand,
  holdSleepAssertion: caffeinate,
  version: PRODUCT_VERSION,
  stdin: process.stdin,
  stdout: process.stdout,
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  setupLog: (proc, home) => {
    const processLog = setupProcessLog({
      proc,
      env: { ...process.env, [HOME_ENV]: home },
      console: process.stderr,
      consoleLevel: "error",
    });
    exitOnFatal(process, log, (code) => process.exit(code));
    return () => processLog.close();
  },
  onStopSignal: (handler) => {
    process.on("SIGINT", handler);
    process.on("SIGTERM", handler);
  },
});
