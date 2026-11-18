import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { caffeinate } from "./keep-awake.js";
import { appLayout } from "./layout.js";
import { runCommand, runProgram } from "./program.js";

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
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  onStopSignal: (handler) => {
    process.on("SIGINT", handler);
    process.on("SIGTERM", handler);
  },
});
