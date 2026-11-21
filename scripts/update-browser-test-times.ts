import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  BROWSER_TEST_TIMES_FILE,
  medianTimes,
  parseFileTimes,
  parseLogTimes,
  refreshTimes,
} from "./time-shards.ts";

const REPO_ROOT = new URL("../", import.meta.url);
const MAX_LOG_BYTES = 256 * 1024 * 1024;

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: MAX_LOG_BYTES });
}

function readRunTimes(runId: string): Map<string, number> {
  const conclusion = gh(["run", "view", runId, "--json", "conclusion", "--jq", ".conclusion"]);
  if (conclusion.trim() !== "success") {
    throw new Error(`run ${runId} did not succeed (${conclusion.trim() || "in progress"})`);
  }
  const times = parseLogTimes(gh(["run", "view", runId, "--log"]));
  if (times.size === 0) throw new Error(`run ${runId} has no browser test times in its log`);
  return times;
}

function main(runIds: string[]): void {
  if (runIds.length === 0 || runIds.some((id) => !/^\d+$/.test(id))) {
    throw new Error("usage: pnpm run update:browser-times <run-id> [<run-id>...]");
  }
  const previous = parseFileTimes(JSON.parse(readFileSync(BROWSER_TEST_TIMES_FILE, "utf8")));
  const measured = medianTimes(runIds.map(readRunTimes));
  const refreshed = refreshTimes(previous, measured, (path) =>
    existsSync(new URL(path, REPO_ROOT)),
  );
  writeFileSync(
    BROWSER_TEST_TIMES_FILE,
    `${JSON.stringify(Object.fromEntries(refreshed), null, 2)}\n`,
  );
  console.log(`Wrote times for ${refreshed.size} files from ${runIds.length} runs.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2).filter((arg) => arg !== "--"));
}
