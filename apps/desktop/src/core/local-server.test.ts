import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalServer, fileRecordStore, sleep } from "./local-server.js";
import type { LocalServerOptions } from "./local-server.js";
import { ServerWatch } from "./watch.js";

/*
 * ②의 띄우기·붙기·멈추기·바꾸기·감시를 실제 프로세스로 본다. 서버 배포물의 CLI 자리에 잠금 계약만 흉내 내는
 * 시험용 CLI(testing/fake-server-cli.mjs)를 넣는다. 실제 배포물로 도는 확인은 `pnpm --filter @factory/desktop smoke`.
 */

const FAKE_CLI = fileURLToPath(new URL("./testing/fake-server-cli.mjs", import.meta.url));

let dir: string;
let home: string;
let port: number;
const others: ChildProcess[] = [];

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const found = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(found));
    });
  });
}

function events(kind: string): number[] {
  const file = join(home, "events.log");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.startsWith(`${kind} `))
    .map((line) => Number(line.split(" ")[1]));
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function workerPids(): number[] {
  const file = join(home, "workers.log");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map(Number);
}

function server(overrides: Partial<LocalServerOptions> = {}): LocalServer {
  return new LocalServer({
    home,
    bundle: { cliEntry: FAKE_CLI, buildId: "build-a" },
    node: { command: process.execPath, env: { ...process.env, FAKE_PORT: String(port) } },
    records: fileRecordStore(join(dir, "app", "server-process.json")),
    logFile: join(dir, "app", "server.log"),
    pollMs: 50,
    readyTimeoutMs: 10_000,
    stopTimeoutMs: 5_000,
    ...overrides,
  });
}

async function responds(): Promise<boolean> {
  try {
    return (await fetch(`http://127.0.0.1:${port}/api/identity`)).ok;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "factory-desktop-"));
  home = join(dir, "home");
  port = await freePort();
});

afterEach(async () => {
  for (const child of others.splice(0)) child.kill("SIGKILL");
  for (const pid of [...events("start"), ...events("refused"), ...workerPids()]) {
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, "SIGKILL");
      } catch {
        // 이미 끝났다.
      }
    }
  }
  await sleep(50);
  rmSync(dir, { recursive: true, force: true });
});

describe("LocalServer", () => {
  it("home 이 비었으면 init 뒤 ②를 앱과 다른 프로세스 그룹으로 띄운다", async () => {
    const result = await server().ensureRunning();
    expect(result).toMatchObject({ kind: "running", replaced: false, status: { owner: "app" } });
    expect(events("init")).toHaveLength(1);
    const [pid] = events("start");
    if (pid === undefined) throw new Error("start missing");
    // detached: 새 세션의 리더라 그룹 ID 가 자기 pid 다. 앱(이 시험 프로세스)의 그룹과 다르다.
    const pgid = Number(
      spawnSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" }).stdout,
    );
    expect(pgid).toBe(pid);
    expect(pgid).not.toBe(
      Number(
        spawnSync("ps", ["-o", "pgid=", "-p", String(process.pid)], { encoding: "utf8" }).stdout,
      ),
    );
  });

  it("앱을 다시 열면 도는 같은 ②에 붙고 새로 띄우지 않는다(pid 가 그대로다)", async () => {
    const first = await server().ensureRunning();
    if (first.kind !== "running") throw new Error(JSON.stringify(first));

    // 앱이 끝났다가 다시 열린 것: 새 LocalServer 가 같은 기록 파일을 읽는다.
    const reopened = await server().ensureRunning();
    expect(reopened).toMatchObject({ kind: "running", replaced: false, status: { owner: "app" } });
    if (reopened.kind !== "running") return;
    expect(reopened.status.pid).toBe(first.status.pid);
    expect(events("start")).toEqual([first.status.pid]);
  });

  it("두 앱이 함께 열려도 같은 home 에 서버는 한 벌만 돈다", async () => {
    const a = server({ records: fileRecordStore(join(dir, "app-a.json")) });
    const b = server({ records: fileRecordStore(join(dir, "app-b.json")) });
    const [ra, rb] = await Promise.all([a.ensureRunning(), b.ensureRunning()]);
    if (ra.kind !== "running" || rb.kind !== "running") throw new Error(JSON.stringify([ra, rb]));
    expect(ra.status.pid).toBe(rb.status.pid);
    // 잠금을 쥔 start 만 worker 를 띄운다. 진 쪽은 잠금에서 거절돼 끝났다.
    expect(events("start")).toHaveLength(1);
    expect(workerPids().filter(alive)).toHaveLength(1);
    expect([ra.status.owner, rb.status.owner].toSorted()).toEqual(["app", "external"]);
  });

  it("③(앱이 띄우지 않은 start)이 돌면 붙기만 하고 멈추지 않는다", async () => {
    mkdirSync(home, { recursive: true });
    spawnSync(process.execPath, [FAKE_CLI, "init", "--home", home], {
      env: { ...process.env, FAKE_PORT: String(port) },
    });
    const service = spawn(process.execPath, [FAKE_CLI, "start", "--home", home], {
      stdio: "ignore",
    });
    others.push(service);
    while (!(await responds())) await sleep(50);

    const local = server();
    const result = await local.ensureRunning();
    expect(result).toMatchObject({
      kind: "running",
      status: { owner: "external", pid: service.pid },
    });
    expect(await local.stop()).toEqual({ ok: false, reason: "not-owned" });
    expect(await responds()).toBe(true);
    expect(events("start")).toEqual([service.pid]);
  });

  it("③이 이 home 에 등록돼 있고 돌지 않으면 ②를 띄우지 않는다", async () => {
    const result = await server({ serviceInstalled: () => true }).ensureRunning();
    expect(result).toEqual({ kind: "service-not-running" });
    expect(events("start")).toEqual([]);
  });

  it("멈추면 web 이 응답을 멈추고, 다시 켜면 다시 응답한다", async () => {
    const local = server();
    await local.ensureRunning();
    expect(await responds()).toBe(true);

    expect(await local.stop()).toEqual({ ok: true });
    expect(await responds()).toBe(false);
    expect(workerPids().filter(alive)).toEqual([]);

    expect(await local.ensureRunning()).toMatchObject({ kind: "running" });
    expect(await responds()).toBe(true);
  });

  it("서버 코드가 바뀌면 옛 ②를 멈춘 뒤 새 ②를 띄워 worker 가 겹치지 않는다", async () => {
    const before = await server().ensureRunning();
    if (before.kind !== "running") throw new Error(JSON.stringify(before));
    const oldPid = before.status.pid;

    const after = await server({
      bundle: { cliEntry: FAKE_CLI, buildId: "build-b" },
    }).ensureRunning();
    expect(after).toMatchObject({ kind: "running", replaced: true, status: { owner: "app" } });
    if (after.kind !== "running" || oldPid === undefined) return;
    expect(after.status.pid).not.toBe(oldPid);
    expect(alive(oldPid)).toBe(false);

    // 옛 start 가 멈춘(stop) 뒤에 새 start 가 잠금을 쥐었다(start).
    const log = readFileSync(join(home, "events.log"), "utf8");
    const stopAt = Number(/^stop \d+ (\d+)$/m.exec(log)?.[1]);
    const startAt = Number(new RegExp(`^start ${after.status.pid} (\\d+)$`, "m").exec(log)?.[1]);
    expect(stopAt).toBeLessThanOrEqual(startAt);
    expect(workerPids().filter(alive)).toHaveLength(1);

    // 같은 서버 코드로 다시 열면 바꾸지 않는다.
    expect(
      await server({ bundle: { cliEntry: FAKE_CLI, buildId: "build-b" } }).ensureRunning(),
    ).toMatchObject({ kind: "running", replaced: false, status: { pid: after.status.pid } });
  });

  it("기록한 pid 가 재부팅 뒤 다른 프로세스에 다시 쓰였으면 그 프로세스를 ②로 보지 않고 건드리지 않는다", async () => {
    const stranger = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    others.push(stranger);
    if (stranger.pid === undefined) throw new Error("no pid");
    const records = fileRecordStore(join(dir, "app", "server-process.json"));
    records.write({
      pid: stranger.pid,
      buildId: "build-a",
      home,
      spawnedAt: "2000-01-01T00:00:00.000Z",
      root: dirname(FAKE_CLI),
    });
    // 전원이 꺼져 남은 잠금도 같은 pid 를 가리킨다.
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, "server.lock"),
      JSON.stringify({
        pid: stranger.pid,
        url: `http://127.0.0.1:${port}`,
        startedAt: "2000-01-01T00:00:00.000Z",
      }),
    );
    const local = server({ records });
    expect(await local.status()).toEqual({ state: "stopped" });
    const result = await local.ensureRunning();
    expect(result).toMatchObject({ kind: "running", status: { owner: "app" } });
    if (result.kind !== "running") return;
    expect(result.status.pid).not.toBe(stranger.pid);
    expect(alive(stranger.pid)).toBe(true);
  });

  it("재부팅 뒤 ③이 앱이 기록한 pid 를 다시 받아 잠금을 쥐면 ③으로 보고 멈추거나 바꾸지 않는다", async () => {
    mkdirSync(home, { recursive: true });
    spawnSync(process.execPath, [FAKE_CLI, "init", "--home", home], {
      env: { ...process.env, FAKE_PORT: String(port) },
    });
    const service = spawn(process.execPath, [FAKE_CLI, "start", "--home", home], {
      stdio: "ignore",
    });
    others.push(service);
    while (!(await responds())) await sleep(50);
    if (service.pid === undefined) throw new Error("no pid");
    // 앱이 예전(재부팅 전)에 같은 pid 로 ②를 띄웠다는 기록. 서버 코드도 달라 버전 교체 조건에 걸린다.
    const records = fileRecordStore(join(dir, "app", "server-process.json"));
    records.write({
      pid: service.pid,
      buildId: "old-build",
      home,
      spawnedAt: "2000-01-01T00:00:00.000Z",
      root: dirname(FAKE_CLI),
    });
    const local = server({ records });
    expect(await local.status()).toMatchObject({ state: "running", owner: "external" });
    expect(await local.ensureRunning()).toMatchObject({
      kind: "running",
      replaced: false,
      status: { owner: "external", pid: service.pid },
    });
    expect(await local.stop()).toEqual({ ok: false, reason: "not-owned" });
    expect(alive(service.pid)).toBe(true);
    expect(events("start")).toEqual([service.pid]);
  });

  it("뜨지 못하고 끝나면 실패를 알린다", async () => {
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, ".env"), 'WEB_PORT="not-a-port"\n');
    const result = await server().ensureRunning();
    expect(result).toMatchObject({ kind: "failed" });
  });
});

describe("ServerWatch", () => {
  it("②를 강제로 끝내면 다시 띄우고 남은 worker 도 치운다", async () => {
    const local = server();
    const watch = new ServerWatch(local);
    const first = await local.ensureRunning();
    watch.adopt(first);
    if (first.kind !== "running" || first.status.pid === undefined) throw new Error("not running");
    const [oldWorker] = workerPids();

    process.kill(first.status.pid, "SIGKILL");
    while (alive(first.status.pid)) await sleep(20);
    expect(oldWorker !== undefined && alive(oldWorker)).toBe(true);

    await watch.tick();
    expect(watch.state).toMatchObject({ kind: "running", owner: "app" });
    expect(await responds()).toBe(true);
    const restarted = events("start");
    expect(restarted).toHaveLength(2);
    expect(restarted[1]).not.toBe(first.status.pid);
    expect(workerPids().filter(alive)).toHaveLength(1);
  });

  it("start 만 강제로 끝나 web 이 남아 답해도 다른 서버로 보지 않고 그룹째 치운 뒤 다시 띄운다", async () => {
    const local = server({
      node: {
        command: process.execPath,
        env: { ...process.env, FAKE_PORT: String(port), FAKE_WEB_CHILD: "1" },
      },
    });
    const watch = new ServerWatch(local);
    const first = await local.ensureRunning();
    watch.adopt(first);
    if (first.kind !== "running" || first.status.pid === undefined) throw new Error("not running");
    const leftovers = workerPids();
    expect(leftovers).toHaveLength(2);

    process.kill(first.status.pid, "SIGKILL");
    while (alive(first.status.pid)) await sleep(20);
    expect(await responds()).toBe(true);
    expect(await local.status()).toEqual({ state: "stopped" });

    await watch.tick();
    expect(watch.state).toMatchObject({ kind: "running", owner: "app" });
    for (const pid of leftovers) expect(alive(pid)).toBe(false);
    expect(events("start")).toHaveLength(2);
  });

  it("사람이 멈춘 ②는 다시 띄우지 않는다", async () => {
    const local = server();
    const watch = new ServerWatch(local);
    watch.adopt(await local.ensureRunning());
    watch.setWanted(false);
    await local.stop();

    await watch.tick();
    expect(watch.state).toEqual({ kind: "stopped", owner: "app" });
    expect(events("start")).toHaveLength(1);
  });

  it("③이 멈추면 대신 띄우지 않는다", async () => {
    mkdirSync(home, { recursive: true });
    spawnSync(process.execPath, [FAKE_CLI, "init", "--home", home], {
      env: { ...process.env, FAKE_PORT: String(port) },
    });
    const service = spawn(process.execPath, [FAKE_CLI, "start", "--home", home], {
      stdio: "ignore",
    });
    others.push(service);
    while (!(await responds())) await sleep(50);
    const local = server();
    const watch = new ServerWatch(local);
    watch.adopt(await local.ensureRunning());

    service.kill("SIGTERM");
    while (await responds()) await sleep(50);
    await watch.tick();
    expect(watch.state).toEqual({ kind: "stopped", owner: "external" });
    expect(events("start")).toEqual([service.pid]);
  });

  it("짧은 시간에 거듭 끝나면 그만 띄우고 실패로 알린다", async () => {
    let clock = 0;
    const local = server();
    const watch = new ServerWatch(local, { maxRestarts: 2, now: () => clock });
    watch.adopt(await local.ensureRunning());
    for (let round = 0; round < 3; round += 1) {
      const pid = events("start").at(-1);
      if (pid === undefined) throw new Error("no start");
      process.kill(pid, "SIGKILL");
      while (alive(pid)) await sleep(20);
      clock += 1_000;
      await watch.tick();
    }
    expect(watch.state).toEqual({ kind: "failed", reason: "the server kept exiting" });
    expect(events("start")).toHaveLength(3);

    watch.setWanted(true);
    await watch.tick();
    expect(watch.state).toMatchObject({ kind: "running" });
  });
});
