import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { homePaths, readBootEnv } from "@factory/cli/home";
import { isProcessAlive, readLiveServerLock } from "@factory/cli/server-lock";
import type { RunId } from "@factory/core";
import { getRunWithRecords, openDatabase, parseBootConfig, updateRunRecords } from "@factory/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { LocalServer, fileRecordStore, sleep } from "../src/core/local-server.js";
import { loadServerBundle } from "../src/core/server-bundle.js";
import type { ServerBundle } from "../src/core/server-bundle.js";
import { ServerWatch } from "../src/core/watch.js";
import { freePort, nodeEnv, seedRunningRun } from "./helpers.js";

/*
 * 실제 서버 배포물(0029)과 Electron 의 Node 로 ②를 띄워 티켓 0046 의 완료 조건을 본다. CI 에서는 돌지 않는다
 * (Electron 바이너리와 빌드한 배포물이 필요하다). 저장소 루트에서:
 *
 *   pnpm build && pnpm run bundle
 *   pnpm --filter @factory/desktop exec node node_modules/electron/install.js   # Electron 바이너리(처음 한 번)
 *   pnpm --filter @factory/desktop smoke
 *
 * 임시 home 과 배포물 복사본을 쓰고 끝나면 지운다. 러너는 닿지 않는 ssh 대상(.invalid)이라 Running 런은
 * worker 가 폴링할 때마다 닿지 않음(unreachableSince)을 기록한다. 5분 안에는 Disconnected 가 되지 않는다.
 */

const DESKTOP = resolve(import.meta.dirname, "..");
const REPO = resolve(DESKTOP, "..", "..");
const ELECTRON =
  process.env["SMOKE_ELECTRON"] ??
  join(
    DESKTOP,
    "node_modules",
    "electron",
    "dist",
    "Electron.app",
    "Contents",
    "MacOS",
    "Electron",
  );

let dir: string;
let home: string;
let bundleA: ServerBundle;
let bundleB: ServerBundle;
let runId: RunId;
const extra: ChildProcess[] = [];

function local(bundle: ServerBundle, records = "app.json"): LocalServer {
  return new LocalServer({
    home,
    bundle,
    node: { command: ELECTRON, env: nodeEnv() },
    records: fileRecordStore(join(dir, records)),
    logFile: join(home, "logs", "desktop-server.log"),
  });
}

/** 이 시험의 배포물 복사본에서 뜬 프로세스(start, web, worker) */
function processes(kind: "start" | "worker" | "web"): number[] {
  const out = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" }).stdout;
  const marker = {
    start: "cli/bin/cli.js start",
    worker: "worker/server/main.js",
    web: "web/srvx/srvx.js",
  }[kind];
  return out
    .split("\n")
    .filter((line) => line.includes(dir) && line.includes(marker))
    .map((line) => Number(line.trim().split(/\s+/)[0]));
}

function runState(): { state: string; unreachableSince: Date | null } {
  const config = parseBootConfig(readBootEnv(homePaths(home).envFile, {}));
  const db = openDatabase(config.databasePath);
  try {
    db.$client.exec("PRAGMA busy_timeout = 5000");
    const found = getRunWithRecords(db, runId);
    if (found === undefined || found === null) throw new Error("run missing");
    return { state: found.run.state, unreachableSince: found.records.unreachableSince };
  } finally {
    db.$client.close();
  }
}

function clearUnreachable(): void {
  const config = parseBootConfig(readBootEnv(homePaths(home).envFile, {}));
  const db = openDatabase(config.databasePath);
  try {
    db.$client.exec("PRAGMA busy_timeout = 5000");
    updateRunRecords(db, runId, { unreachableSince: null });
  } finally {
    db.$client.close();
  }
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
  dir = mkdtempSync(join(tmpdir(), "factory-desktop-smoke-"));
  home = join(dir, "home");
  const { version } = z
    .object({ version: z.string() })
    .parse(JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")));
  const source = join(REPO, "dist", `factory-orchestrator-${version}`);
  // 앱 업데이트를 흉내 낸다: 같은 배포물을 두 곳에 두고 B 는 버전만 바꾼다(서버 코드 지문이 달라진다).
  cpSync(source, join(dir, "bundle-a"), { recursive: true });
  cpSync(source, join(dir, "bundle-b"), { recursive: true });
  const bPackage = join(dir, "bundle-b", "package.json");
  writeFileSync(
    bPackage,
    readFileSync(bPackage, "utf8").replace(/"version": "[^"]+"/, '"version": "0.0.1-smoke"'),
  );
  bundleA = loadServerBundle(join(dir, "bundle-a"));
  bundleB = loadServerBundle(join(dir, "bundle-b"));
  const port = await freePort();
  // 앱이 init 을 부르기 전에 포트만 정해 둔다(이 기계의 3000 은 쓰지 않는다).
  const init = spawnSync(
    ELECTRON,
    [bundleA.cliEntry, "init", "--home", home, "--port", String(port)],
    {
      env: nodeEnv(),
      encoding: "utf8",
    },
  );
  if (init.status !== 0) throw new Error(init.stderr);
});

afterAll(async () => {
  for (const child of extra) child.kill("SIGTERM");
  const lock = readLiveServerLock(home);
  if (lock !== undefined) {
    try {
      process.kill(-lock.pid, "SIGTERM");
    } catch {
      // 이미 끝났다.
    }
  }
  await sleep(2_000);
  for (const pid of [...processes("start"), ...processes("web"), ...processes("worker")]) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // 이미 끝났다.
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("실제 서버 배포물로 띄운 ②", () => {
  it("앱을 끝내고 다시 열어도 같은 ②에 붙고 Running 런이 Running 으로 남는다", async () => {
    const first = await local(bundleA).ensureRunning();
    if (first.kind !== "running") throw new Error(JSON.stringify(first));
    expect(first.status.owner).toBe("app");
    runId = seedRunningRun(home);
    await waitFor(
      () => runState().unreachableSince !== null,
      60_000,
      "worker did not poll the running run",
    );
    console.log(`② pid ${first.status.pid}, run ${runId} watched by the worker`);

    // 앱이 끝났다: LocalServer 를 버리고 새로 만든다. ②는 앱과 다른 세션이라 계속 돈다.
    const reopened = await local(bundleA).ensureRunning();
    if (reopened.kind !== "running") throw new Error(JSON.stringify(reopened));
    expect(reopened.status.pid).toBe(first.status.pid);
    expect(reopened.replaced).toBe(false);
    expect(runState().state).toBe("running");
    expect(processes("start")).toEqual([first.status.pid]);
    expect(processes("worker")).toHaveLength(1);
  });

  it("두 앱이 함께 열려도 web·worker 는 한 벌만 돈다", async () => {
    const [a, b] = await Promise.all([
      local(bundleA, "app.json").ensureRunning(),
      local(bundleA, "other-app.json").ensureRunning(),
    ]);
    if (a.kind !== "running" || b.kind !== "running") throw new Error(JSON.stringify([a, b]));
    expect(a.status.pid).toBe(b.status.pid);
    expect(processes("start")).toHaveLength(1);
    expect(processes("web")).toHaveLength(1);
    expect(processes("worker")).toHaveLength(1);
  });

  it("서버 코드가 바뀌면 옛 ②를 멈추고 새 ②를 띄우며, worker 가 겹치지 않고 새 worker 가 런을 이어 감시한다", async () => {
    const before = readLiveServerLock(home);
    if (before === undefined) throw new Error("not running");
    let maxWorkers = 0;
    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        maxWorkers = Math.max(maxWorkers, processes("worker").length);
        await sleep(50);
      }
    })();
    const replaced = await local(bundleB).ensureRunning();
    sampling = false;
    await sampler;
    if (replaced.kind !== "running") throw new Error(JSON.stringify(replaced));
    expect(replaced.replaced).toBe(true);
    expect(replaced.status.pid).not.toBe(before.pid);
    expect(maxWorkers).toBe(1);
    expect(processes("worker")).toHaveLength(1);
    expect(processes("start")).toEqual([replaced.status.pid]);

    expect(runState().state).toBe("running");
    clearUnreachable();
    await waitFor(
      () => runState().unreachableSince !== null,
      60_000,
      "the new worker did not poll the run",
    );
    expect(runState().state).toBe("running");
    console.log(
      `replaced ② ${before.pid} -> ${replaced.status.pid}; max workers during swap: ${maxWorkers}`,
    );
  });

  it("트레이에서 멈추면 web 이 응답을 멈추고, 다시 켜면 다시 응답한다", async () => {
    const server = local(bundleB);
    const url = server.configuredUrl();
    if (url === undefined) throw new Error("no url");
    expect((await fetch(url)).status).toBeLessThan(500);
    expect(await server.stop()).toEqual({ ok: true });
    await expect(fetch(url)).rejects.toThrow("fetch failed");
    expect(processes("worker")).toEqual([]);
    expect(await server.ensureRunning()).toMatchObject({ kind: "running" });
    expect((await fetch(url)).status).toBeLessThan(500);
  });

  it("②를 강제로 끝내면 감시가 다시 띄운다", async () => {
    const server = local(bundleB);
    const watch = new ServerWatch(server);
    const current = await server.ensureRunning();
    watch.adopt(current);
    if (current.kind !== "running" || current.status.pid === undefined)
      throw new Error("not running");
    process.kill(current.status.pid, "SIGKILL");
    // 이 시험 프로세스가 띄운 자식이라 거둘 때까지(좀비가 사라질 때까지) 기다린다.
    await waitFor(() => !isProcessAlive(current.status.pid ?? 0), 10_000, "start did not die");
    await watch.tick();
    expect(watch.state).toMatchObject({ kind: "running", owner: "app" });
    const after = readLiveServerLock(home);
    if (after === undefined) throw new Error("not restarted");
    expect(after.pid).not.toBe(current.status.pid);
    // SIGKILL 로 끝난 start 의 web·worker 는 남지 않는다.
    expect(processes("start")).toEqual([after.pid]);
    expect(processes("web")).toHaveLength(1);
    expect(processes("worker")).toHaveLength(1);
    expect(runState().state).toBe("running");
  });

  it("③(서비스가 띄운 start)이 돌면 붙기만 하고 켜고 끄지 않는다", async () => {
    expect(await local(bundleB).stop()).toEqual({ ok: true });
    const service = spawn(ELECTRON, [bundleB.cliEntry, "start", "--home", home], {
      env: nodeEnv(),
      stdio: "ignore",
    });
    extra.push(service);
    const server = local(bundleB);
    await waitFor(
      async () => (await server.status()).state === "running",
      60_000,
      "service did not start",
    );
    const attached = await server.ensureRunning();
    expect(attached).toMatchObject({
      kind: "running",
      status: { owner: "external", pid: service.pid },
    });
    expect(await server.stop()).toEqual({ ok: false, reason: "not-owned" });
    expect(processes("start")).toEqual([service.pid]);
    expect(processes("worker")).toHaveLength(1);
  });
});
