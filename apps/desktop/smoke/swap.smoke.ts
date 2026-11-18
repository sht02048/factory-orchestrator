import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { homePaths, readBootEnv } from "@ganger/cli/home";
import { isProcessAlive, readLiveServerLock } from "@ganger/cli/server-lock";
import { getRunWithRecords, openDatabase, parseBootConfig, updateRunRecords } from "@ganger/db";
import type { RunId } from "@ganger/core";
import { _electron } from "playwright-core";
import type { ElectronApplication } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { probeIdentity } from "../src/core/identity.js";
import { sleep } from "../src/core/local-server.js";
import { freePort, nodeEnv, seedRunningRun } from "./helpers.js";

const DESKTOP = resolve(import.meta.dirname, "..");
const APP_A =
  process.env["SMOKE_APP"] ?? join(DESKTOP, "dist", "app", "Ganger-darwin-arm64", "Ganger.app");
const APP_B = process.env["SMOKE_APP_B"];
const executable = (app: string) => join(app, "Contents", "MacOS", "Ganger");

let dir: string;
let home: string;
let port: number;
let runId: RunId;

function launch(app: string): Promise<ElectronApplication> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(nodeEnv())) {
    if (value !== undefined && name !== "ELECTRON_RUN_AS_NODE") env[name] = value;
  }
  return _electron.launch({
    executablePath: executable(app),
    env: { ...env, GANGER_HOME: home, GANGER_DESKTOP_USER_DATA: join(dir, "user-data") },
  });
}

function withDb<T>(run: (db: ReturnType<typeof openDatabase>) => T): T {
  const config = parseBootConfig(readBootEnv(homePaths(home).envFile, {}));
  const db = openDatabase(config.databasePath);
  try {
    db.$client.exec("PRAGMA busy_timeout = 5000");
    return run(db);
  } finally {
    db.$client.close();
  }
}

function run(): { state: string; unreachableSince: Date | null } {
  return withDb((db) => {
    const found = getRunWithRecords(db, runId);
    if (found === undefined || found === null) throw new Error("run missing");
    return { state: found.run.state, unreachableSince: found.records.unreachableSince };
  });
}

function workers(): number {
  const out = spawnSync("ps", ["-axo", "command="], { encoding: "utf8" }).stdout;
  return out
    .split("\n")
    .filter((line) => line.includes("Ganger.app") && line.includes("worker/server/main.js")).length;
}

async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs: number,
  what: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(250);
  }
  throw new Error(`${what} within ${timeoutMs} ms`);
}

beforeAll(async () => {
  if (APP_B === undefined) throw new Error("SMOKE_APP_B is required (see the header of this file)");
  dir = mkdtempSync(join(tmpdir(), "ganger-desktop-swap-"));
  home = join(dir, "home");
  port = await freePort();
  const cli = join(APP_A, "Contents", "Resources", "server", "cli", "bin", "cli.js");
  const init = spawnSync(executable(APP_A), [cli, "init", "--home", home, "--port", String(port)], {
    env: nodeEnv(),
    encoding: "utf8",
  });
  if (init.status !== 0) throw new Error(init.stderr);
  if (workers() !== 0) throw new Error("another packaged app's worker is running; quit it first");
});

afterAll(async () => {
  const lock = readLiveServerLock(home);
  if (lock !== undefined) {
    try {
      process.kill(-lock.pid, "SIGTERM");
    } catch {}
  }
  await sleep(3_000);
  rmSync(dir, { recursive: true, force: true });
});

describe("앱 업데이트로 서버 코드가 바뀌면", () => {
  it("옛 ②를 멈추고 새 ②를 띄우며, worker 가 겹치지 않고 Running 런을 새 worker 가 이어 감시한다", async () => {
    const url = `http://127.0.0.1:${port}`;
    const a = await launch(APP_A);
    const pageA = await a.firstWindow();
    await pageA.getByRole("button", { name: "이 기계에서 시작하기" }).click();
    await pageA.waitForURL(new RegExp(`^${url}`), { timeout: 90_000 });
    const before = readLiveServerLock(home);
    if (before === undefined) throw new Error("no lock");
    const versionA = await probeIdentity(url, 2_000);
    runId = seedRunningRun(home);
    await waitFor(() => run().unreachableSince !== null, 90_000, "worker A did not poll the run");
    await a.close();
    expect(isProcessAlive(before.pid)).toBe(true);

    let maxWorkers = 0;
    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        maxWorkers = Math.max(maxWorkers, workers());
        await sleep(50);
      }
    })();
    const b = await launch(APP_B ?? "");
    const pageB = await b.firstWindow();
    await pageB.waitForURL(new RegExp(`^${url}`), { timeout: 90_000 });
    sampling = false;
    await sampler;

    const after = readLiveServerLock(home);
    if (after === undefined) throw new Error("no lock after swap");
    const versionB = await probeIdentity(url, 2_000);
    console.log(
      `② ${before.pid} (${versionA.kind === "ours" ? versionA.identity.version : "?"}) -> ${after.pid} (${versionB.kind === "ours" ? versionB.identity.version : "?"}); max workers during swap ${maxWorkers}`,
    );
    expect(after.pid).not.toBe(before.pid);
    expect(isProcessAlive(before.pid)).toBe(false);
    expect(
      versionA.kind === "ours" &&
        versionB.kind === "ours" &&
        versionA.identity.version !== versionB.identity.version,
    ).toBe(true);
    expect(maxWorkers).toBe(1);
    expect(workers()).toBe(1);

    expect(run().state).toBe("running");
    withDb((db) => updateRunRecords(db, runId, { unreachableSince: null }));
    await waitFor(() => run().unreachableSince !== null, 90_000, "worker B did not poll the run");
    expect(run().state).toBe("running");

    const bProcess = b.process();
    void b
      .evaluate(({ Menu }) => {
        const item = Menu.getApplicationMenu()?.getMenuItemById("quit-with-server");
        if (item === null || item === undefined) return;
        setTimeout(() => {
          Reflect.apply(item.click, item, []);
        }, 0);
      })
      .catch(() => undefined);
    await waitFor(() => bProcess.exitCode !== null, 30_000, "app B did not quit");
    expect(readLiveServerLock(home)).toBeUndefined();
  });
});
