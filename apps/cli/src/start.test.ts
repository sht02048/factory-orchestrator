import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMigrations, openDatabase } from "@ganger/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MissingEnvFileError } from "./home.js";
import { init } from "./init.js";
import type { AppLayout, ProcessSpec } from "./layout.js";
import { readServerLock, serverLockPath } from "./server-lock.js";
import { StartError, start, webUrl } from "./start.js";
import type { Started } from "./start.js";

let dir: string;
let started: Started | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ganger-cli-start-"));
});

afterEach(async () => {
  await started?.stop();
  started = undefined;
  rmSync(dir, { recursive: true, force: true });
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

const FAKE_WEB = `
import { createServer } from "node:http";
const server = createServer((_req, res) => res.end(JSON.stringify({ databasePath: process.env.DATABASE_PATH })));
server.listen(Number(process.env.WEB_PORT), process.env.WEB_HOST);
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`;
const FAKE_WORKER = `
const timer = setInterval(() => undefined, 1000);
process.on("SIGTERM", () => { clearInterval(timer); process.exit(0); });
`;
function workerExitingOnceExists(trigger: string): string {
  return `
import { existsSync } from "node:fs";
setInterval(() => { if (existsSync(${JSON.stringify(trigger)})) process.exit(3); }, 50);
`;
}

function fakeLayout(worker: string = FAKE_WORKER): AppLayout {
  const script = (name: ProcessSpec["name"], source: string): ProcessSpec => {
    const file = join(dir, `${name}.mjs`);
    writeFileSync(file, source);
    return { name, command: process.execPath, args: [file], cwd: dir, requires: [file] };
  };
  return { web: () => script("web", FAKE_WEB), worker: () => script("worker", worker) };
}

function appliedMigrations(databasePath: string): number {
  const db = openDatabase(databasePath);
  try {
    return db.$client.prepare("SELECT name FROM schema_migrations").all().length;
  } finally {
    db.$client.close();
  }
}

const quiet = () => undefined;

describe("start", () => {
  it("마이그레이션을 돌린 뒤 web이 바인딩 주소에서 응답한다", async () => {
    const home = join(dir, "home");
    const port = await freePort();
    const setup = init({ home, port: String(port) });
    if (!setup.created) throw new Error("init did not create .env");

    started = await start({ home, env: {}, layout: fakeLayout(), onOutput: quiet });
    expect(started.url).toBe(`http://127.0.0.1:${port}`);
    expect(started.migrated).toEqual(loadMigrations().map((m) => m.name));
    expect(appliedMigrations(setup.databasePath)).toBe(loadMigrations().length);

    const response = await fetch(started.url);
    expect(await response.json()).toEqual({ databasePath: setup.databasePath });

    await started.stop();
    expect(await started.exited).toEqual({});
  });

  it("다시 띄우면 돌릴 마이그레이션이 없다", async () => {
    const home = join(dir, "home");
    init({ home, port: String(await freePort()) });
    const first = await start({ home, env: {}, layout: fakeLayout(), onOutput: quiet });
    await first.stop();

    started = await start({ home, env: {}, layout: fakeLayout(), onOutput: quiet });
    expect(started.migrated).toEqual([]);
  });

  it("한쪽이 먼저 끝나면 다른 쪽도 멈추고 이유를 알린다", async () => {
    const home = join(dir, "home");
    init({ home, port: String(await freePort()) });
    const crashTrigger = join(dir, "crash-worker");
    started = await start({
      home,
      env: {},
      layout: fakeLayout(workerExitingOnceExists(crashTrigger)),
      onOutput: quiet,
    });
    writeFileSync(crashTrigger, "");
    expect(await started.exited).toEqual({ failure: "worker exited with code 3" });
    await expect(fetch(started.url)).rejects.toThrow("fetch failed");
  });

  it("web이 뜨기 전에 끝나면 실패하고 나머지를 멈춘다", async () => {
    const home = join(dir, "home");
    init({ home, port: String(await freePort()) });
    const layout = fakeLayout();
    const crashingWeb: AppLayout = {
      web: (config) => ({ ...layout.web(config), args: ["-e", "process.exit(5)"], requires: [] }),
      worker: () => layout.worker(),
    };
    await expect(start({ home, env: {}, layout: crashingWeb, onOutput: quiet })).rejects.toThrow(
      "stopped before web responded: web exited with code 5",
    );
  });

  it("뜨는 중에 멈추라는 신호를 받으면 web을 더 기다리지 않고 자식을 멈춘다", async () => {
    const home = join(dir, "home");
    init({ home, port: String(await freePort()) });
    const layout = fakeLayout();
    const neverListens: AppLayout = {
      web: (config) => ({ ...layout.web(config), args: ["-e", "setInterval(() => {}, 1000)"] }),
      worker: () => layout.worker(),
    };
    const abort = new AbortController();
    const pending = start({
      home,
      env: {},
      layout: neverListens,
      onOutput: quiet,
      signal: abort.signal,
      onMigrated: () => setTimeout(() => abort.abort(), 300),
    });
    await expect(pending).rejects.toThrow("stopped before web responded: stop requested");
  });

  it("web이 응답하는 중에 신호를 받으면 뜬 것으로 치지 않고 멈춘다", async () => {
    const home = join(dir, "home");
    init({ home, port: String(await freePort()) });
    const abort = new AbortController();
    const pending = start({
      home,
      env: {},
      layout: fakeLayout(),
      onOutput: quiet,
      signal: abort.signal,
      onMigrated: () => abort.abort(),
    });
    await expect(pending).rejects.toThrow("stop requested");
  });

  it("도는 동안 home 에 잠금을 쥐고, 멈추면 놓는다", async () => {
    const home = join(dir, "home");
    init({ home, port: String(await freePort()) });
    started = await start({ home, env: {}, layout: fakeLayout(), onOutput: quiet });
    expect(readServerLock(home)).toMatchObject({ pid: process.pid, url: started.url });

    await started.stop();
    expect(existsSync(serverLockPath(home))).toBe(false);
  });

  it("같은 home 에 두 번째 start 는 마이그레이션 전에 거절하고 첫 번째를 건드리지 않는다", async () => {
    const home = join(dir, "home");
    init({ home, port: String(await freePort()) });
    started = await start({ home, env: {}, layout: fakeLayout(), onOutput: quiet });
    const lock = readServerLock(home);
    if (lock === undefined) throw new Error("lock missing");
    writeFileSync(serverLockPath(home), JSON.stringify({ ...lock, pid: process.ppid }));

    let migratedAgain = false;
    await expect(
      start({
        home,
        env: {},
        layout: fakeLayout(),
        onOutput: quiet,
        onMigrated: () => (migratedAgain = true),
      }),
    ).rejects.toThrow(
      new StartError(
        `another start is already running for this home (pid ${process.ppid}, ${started.url})`,
      ),
    );
    expect(migratedAgain).toBe(false);
    expect((await fetch(started.url)).ok).toBe(true);
    writeFileSync(serverLockPath(home), JSON.stringify(lock));
  });

  it("쥔 프로세스가 없는 낡은 잠금은 새로 쥔다", async () => {
    const home = join(dir, "home");
    init({ home, port: String(await freePort()) });
    const gone = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], {
      encoding: "utf8",
    });
    writeFileSync(
      serverLockPath(home),
      JSON.stringify({ pid: Number(gone.stdout), url: "http://127.0.0.1:1", startedAt: "x" }),
    );
    started = await start({ home, env: {}, layout: fakeLayout(), onOutput: quiet });
    expect(readServerLock(home)?.pid).toBe(process.pid);
  });

  it("web 이 뜨기 전에 실패해도 잠금을 남기지 않는다", async () => {
    const home = join(dir, "home");
    init({ home, port: String(await freePort()) });
    const layout = fakeLayout();
    const crashingWeb: AppLayout = {
      web: (config) => ({ ...layout.web(config), args: ["-e", "process.exit(5)"], requires: [] }),
      worker: () => layout.worker(),
    };
    await expect(start({ home, env: {}, layout: crashingWeb, onOutput: quiet })).rejects.toThrow(
      StartError,
    );
    expect(existsSync(serverLockPath(home))).toBe(false);
  });

  it(".env가 없으면 init을 먼저 하라고 실패한다", async () => {
    await expect(
      start({ home: join(dir, "none"), env: {}, layout: fakeLayout(), onOutput: quiet }),
    ).rejects.toThrow(MissingEnvFileError);
  });

  it("빌드 산출물이 없으면 마이그레이션 전에 실패한다", async () => {
    const home = join(dir, "home");
    const setup = init({ home });
    if (!setup.created) throw new Error("init did not create .env");
    const missing: AppLayout = {
      web: () => ({
        name: "web",
        command: process.execPath,
        args: [],
        cwd: dir,
        requires: [join(dir, "missing.js")],
      }),
      worker: () => fakeLayout().worker(),
    };
    await expect(start({ home, env: {}, layout: missing, onOutput: quiet })).rejects.toThrow(
      StartError,
    );
    expect(existsSync(setup.databasePath)).toBe(false);
  });
});

describe("webUrl", () => {
  it("모든 인터페이스에 바인딩하면 루프백으로 닿는다", () => {
    expect(webUrl({ host: "127.0.0.1", port: 3000 })).toBe("http://127.0.0.1:3000");
    expect(webUrl({ host: "0.0.0.0", port: 3000 })).toBe("http://127.0.0.1:3000");
    expect(webUrl({ host: "::", port: 3000 })).toBe("http://[::1]:3000");
    expect(webUrl({ host: "fd7a::1", port: 80 })).toBe("http://[fd7a::1]:80");
  });
});
