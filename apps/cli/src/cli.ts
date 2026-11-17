import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { workspaceLayout } from "./layout.js";
import { runCommand, runProgram } from "./program.js";

/*
 * CLI 진입점(`pnpm --filter @factory/cli cli <명령>`, 빌드 산출물 `dist/bin/cli.js`).
 * 명령은 init, start, service install, service uninstall이다(ADR 0005, 스펙 9절).
 */
const entry = process.argv[1];
process.exitCode = await runProgram(process.argv.slice(2), {
  env: process.env,
  platform: process.platform,
  userHome: homedir(),
  uid: process.getuid?.() ?? 0,
  nodePath: process.execPath,
  cliEntry: entry === undefined ? "" : realpathSync(entry),
  layout: workspaceLayout(),
  runCommand,
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  onStopSignal: (handler) => {
    process.on("SIGINT", handler);
    process.on("SIGTERM", handler);
  },
});
