import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isProcessAlive, readLiveServerLock } from "@factory/cli/server-lock";
import { _electron } from "playwright-core";
import type { ElectronApplication, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sleep } from "../src/core/local-server.js";
import { freePort, nodeEnv, seedAttention } from "./helpers.js";

const DESKTOP = resolve(import.meta.dirname, "..");
const APP =
  process.env["SMOKE_APP"] ??
  join(DESKTOP, "dist", "app", "Factory Orchestrator-darwin-arm64", "Factory Orchestrator.app");
const EXECUTABLE = join(APP, "Contents", "MacOS", "Factory Orchestrator");
const CLI = join(APP, "Contents", "Resources", "server", "cli", "bin", "cli.js");

let dir: string;
let shots: string;
let home: string;
let port: number;
const services: ChildProcess[] = [];

async function launch(
  userData: string,
  extraEnv: Record<string, string> = {},
): Promise<ElectronApplication> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(nodeEnv())) {
    if (value !== undefined && name !== "ELECTRON_RUN_AS_NODE") env[name] = value;
  }
  return _electron.launch({
    executablePath: EXECUTABLE,
    env: {
      ...env,
      FACTORY_HOME: home,
      FACTORY_DESKTOP_USER_DATA: userData,
      FACTORY_TAILSCALE_CLI: join(dir, "no-tailscale"),
      ...extraEnv,
    },
  });
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(shots, `${name}.png`) });
}

async function webResponds(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2_000) })).status < 500;
  } catch {
    return false;
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

async function clickMenu(app: ElectronApplication, id: string, quits = false): Promise<void> {
  const clicked = app.evaluate(({ Menu }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId);
    if (item === null || item === undefined) throw new Error(`menu item ${itemId} not found`);
    setTimeout(() => {
      Reflect.apply(item.click, item, []);
    }, 0);
  }, id);
  if (quits) void clicked.catch(() => undefined);
  else await clicked;
}

async function recordNotifications(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ Notification }) => {
    const shown: string[] = [];
    Object.assign(globalThis, { smokeNotifications: shown });
    Notification.prototype.show = function show(this: Electron.Notification) {
      shown.push(this.title);
    };
  });
}

async function notifications(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => {
    const value: unknown = Reflect.get(globalThis, "smokeNotifications");
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "factory-desktop-app-"));
  shots = process.env["SMOKE_SCREENSHOTS"] ?? join(dir, "screenshots");
  mkdirSync(shots, { recursive: true });
  home = join(dir, "home");
  port = await freePort();
  const init = spawnSync(EXECUTABLE, [CLI, "init", "--home", home, "--port", String(port)], {
    env: nodeEnv(),
    encoding: "utf8",
  });
  if (init.status !== 0) throw new Error(`init failed: ${init.stderr}`);
});

afterAll(async () => {
  for (const service of services) service.kill("SIGTERM");
  for (const target of [home, join(dir, "remote-home")]) {
    const lock = readLiveServerLock(target);
    if (lock === undefined) continue;
    try {
      process.kill(-lock.pid, "SIGTERM");
    } catch {}
  }
  await sleep(3_000);
  rmSync(dir, { recursive: true, force: true });
});

describe("패키징한 앱, 로컬 모드", () => {
  const userData = () => join(dir, "user-data-local");
  const url = () => `http://127.0.0.1:${port}`;
  let serverPid: number;

  it("첫 실행 화면이 두 모드를 묻고, 로컬 모드를 고르면 온보딩 화면이 열린다", async () => {
    const app = await launch(userData());
    const page = await app.firstWindow();
    await page.getByText("어떻게 쓸까요?").waitFor();
    expect(await page.getByText("이 기계에서 서버 돌리기").count()).toBe(1);
    expect(await page.getByText("다른 서버에 붙기").count()).toBe(1);
    await shot(page, "01-choose-mode");

    await page.getByRole("button", { name: "이 기계에서 시작하기" }).click();
    await page.waitForURL(/\/onboarding/, { timeout: 90_000 });
    await shot(page, "02-onboarding");
    const lock = readLiveServerLock(home);
    if (lock === undefined) throw new Error("no server lock");
    serverPid = lock.pid;
    console.log(`② pid ${serverPid} at ${lock.url}; window ${page.url()}`);
    await app.close();
  });

  it("트레이 '종료'로 앱을 끝내도 ②가 계속 응답하고, 다시 연 앱이 같은 ②에 붙는다", async () => {
    expect(isProcessAlive(serverPid)).toBe(true);
    expect(await webResponds(url())).toBe(true);

    const app = await launch(userData());
    const page = await app.firstWindow();
    await page.waitForURL(new RegExp(`^${url()}`), { timeout: 30_000 });
    expect(readLiveServerLock(home)?.pid).toBe(serverPid);

    const appProcess = app.process();
    await clickMenu(app, "quit-app", true);
    await waitFor(() => appProcess.exitCode !== null, 10_000, "app did not quit");
    expect(isProcessAlive(serverPid)).toBe(true);
    expect(await webResponds(url())).toBe(true);
  });

  it("트레이에서 ②를 멈추면 web 이 응답을 멈추고, 다시 켜면 다시 응답한다", async () => {
    const app = await launch(userData());
    const page = await app.firstWindow();
    await page.waitForURL(new RegExp(`^${url()}`), { timeout: 30_000 });

    await clickMenu(app, "server-stop");
    await waitFor(async () => !(await webResponds(url())), 30_000, "web kept responding");
    await page.getByText("서버를 멈췄어요").waitFor({ timeout: 10_000 });
    await shot(page, "03-local-stopped");

    await clickMenu(app, "server-start");
    await waitFor(() => webResponds(url()), 60_000, "web did not come back");
    await page.waitForURL(new RegExp(`^${url()}`), { timeout: 30_000 });
    serverPid = readLiveServerLock(home)?.pid ?? 0;
    expect(await webResponds(url())).toBe(true);
    await app.close();
  });

  it("Q4 의 네 사건에만 알림을 띄우고 Merged·Failed 에는 띄우지 않는다", async () => {
    const app = await launch(userData());
    await recordNotifications(app);
    const page = await app.firstWindow();
    await page.waitForURL(new RegExp(`^${url()}`), { timeout: 30_000 });
    await sleep(2_000);
    seedAttention(home);
    await waitFor(
      async () => (await notifications(app)).length >= 4,
      150_000,
      "notifications did not arrive",
    );
    await sleep(16_000);
    const titles = await notifications(app);
    console.log(`notifications: ${titles.join(", ")}`);
    expect(titles.toSorted()).toEqual(["Human Check", "Permission", "Question", "Runner Issue"]);
    await app.close();
  });

  it("'서버도 끄고 종료'는 ②까지 멈춘다", async () => {
    const app = await launch(userData());
    const page = await app.firstWindow();
    await page.waitForURL(new RegExp(`^${url()}`), { timeout: 30_000 });
    const pid = readLiveServerLock(home)?.pid;
    if (pid === undefined) throw new Error("not running");

    const appProcess = app.process();
    await clickMenu(app, "quit-with-server", true);
    await waitFor(() => appProcess.exitCode !== null, 30_000, "app did not quit");
    expect(isProcessAlive(pid)).toBe(false);
    expect(await webResponds(url())).toBe(false);
    expect(readLiveServerLock(home)).toBeUndefined();
  });
});

describe("패키징한 앱, 원격 모드", () => {
  const userData = () => join(dir, "user-data-remote");
  let remoteHome: string;
  let remotePort: number;
  let tailscale: string;

  function startRemoteServer(): ChildProcess {
    const service = spawn(EXECUTABLE, [CLI, "start", "--home", remoteHome], {
      env: nodeEnv(),
      stdio: "ignore",
    });
    services.push(service);
    return service;
  }

  beforeAll(async () => {
    remoteHome = join(dir, "remote-home");
    remotePort = await freePort();
    const init = spawnSync(
      EXECUTABLE,
      [CLI, "init", "--home", remoteHome, "--port", String(remotePort)],
      {
        env: nodeEnv(),
        encoding: "utf8",
      },
    );
    if (init.status !== 0) throw new Error(init.stderr);
    tailscale = join(dir, "tailscale");
    const status = {
      BackendState: "Running",
      MagicDNSSuffix: "example.ts.net",
      Peer: {
        "nodekey:1": { HostName: "build-box", DNSName: "localhost.", OS: "linux", Online: true },
        "nodekey:2": {
          HostName: "printer",
          DNSName: "printer.invalid.",
          OS: "linux",
          Online: true,
        },
        "nodekey:3": {
          HostName: "phone",
          DNSName: "phone.example.ts.net.",
          OS: "iOS",
          Online: true,
        },
      },
    };
    writeFileSync(tailscale, `#!/bin/sh\ncat <<'EOF'\n${JSON.stringify(status)}\nEOF\n`);
    chmodSync(tailscale, 0o755);
    mkdirSync(userData(), { recursive: true });
    writeFileSync(join(userData(), "settings.json"), JSON.stringify({ discoveryPort: remotePort }));
  });

  it("같은 tailnet 의 서버만 목록에 나오고, 한 번 클릭으로 그 서버의 web 화면이 열린다", async () => {
    startRemoteServer();
    await waitFor(
      () => webResponds(`http://127.0.0.1:${remotePort}`),
      60_000,
      "remote server did not start",
    );
    const app = await launch(userData(), { FACTORY_TAILSCALE_CLI: tailscale });
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "서버 찾기" }).click();
    await page.getByText("build-box").waitFor({ timeout: 15_000 });
    expect(await page.getByText("printer").count()).toBe(0);
    expect(await page.getByText("phone").count()).toBe(0);
    await shot(page, "04-find-servers");

    await page.getByRole("button", { name: "연결", exact: true }).click();
    await page.waitForURL(new RegExp(`^http://localhost:${remotePort}/`), { timeout: 30_000 });
    await shot(page, "05-remote-web");
    await app.close();
  });

  it("Tailscale 이 없으면 주소 입력으로 넘어가고, 우리 서버가 아닌 주소는 거절한다", async () => {
    const other = join(dir, "user-data-address");
    const app = await launch(other);
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "서버 찾기" }).click();
    await page.getByText("Tailscale 을 찾지 못했어요").waitFor({ timeout: 15_000 });
    await page.getByRole("button", { name: "주소로 연결하기" }).click();
    const notOurs = await freePort();
    const decoy = spawn(process.execPath, [
      "-e",
      `require("node:http").createServer((q, s) => s.end("hello")).listen(${notOurs}, "127.0.0.1")`,
    ]);
    services.push(decoy);
    await waitFor(() => webResponds(`http://127.0.0.1:${notOurs}`), 10_000, "decoy did not start");
    await page.getByRole("textbox").fill(`http://127.0.0.1:${notOurs}`);
    await page.getByRole("button", { name: "연결 확인" }).click();
    await page.getByText("Factory Orchestrator 서버가 아니에요").waitFor({ timeout: 10_000 });
    await shot(page, "06-address-not-ours");
    expect(page.url().startsWith("file:")).toBe(true);
    await app.close();
  });

  it("다시 열면 저장한 서버가 바로 열리고, 꺼져 있으면 '닿지 않아요'를 보인 뒤 다시 뜨면 연다", async () => {
    let app = await launch(userData(), { FACTORY_TAILSCALE_CLI: tailscale });
    let page = await app.firstWindow();
    await page.waitForURL(new RegExp(`^http://localhost:${remotePort}/`), { timeout: 30_000 });
    await app.close();

    const stopped = services.splice(0);
    for (const service of stopped) service.kill("SIGTERM");
    await waitFor(
      () => stopped.every((service) => service.exitCode !== null || service.signalCode !== null),
      30_000,
      "remote kept running",
    );
    expect(await webResponds(`http://127.0.0.1:${remotePort}`)).toBe(false);

    app = await launch(userData(), { FACTORY_TAILSCALE_CLI: tailscale });
    page = await app.firstWindow();
    await page.getByText("build-box에 닿지 않아요").waitFor({ timeout: 30_000 });
    await shot(page, "07-unreachable");

    startRemoteServer();
    await page.waitForURL(new RegExp(`^http://localhost:${remotePort}/`), { timeout: 90_000 });
    expect(await page.getByText("build-box에 닿지 않아요").count()).toBe(0);
    await app.close();
  });
});
