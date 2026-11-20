import { EventEmitter } from "node:events";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ELECTRON_INSTALL_COMMAND,
  desktopDevEnv,
  electronBinary,
  superviseDesktop,
} from "./desktop-process.ts";
import type { DesktopChild } from "./desktop-process.ts";

class FakeChild extends EventEmitter implements DesktopChild {
  readonly signals: NodeJS.Signals[] = [];
  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);
    return true;
  }
}

function setup(stop: () => Promise<void> = () => Promise.resolve()) {
  const child = new FakeChild();
  const signals = new EventEmitter();
  const lines: string[] = [];
  const stopServer = vi.fn<() => Promise<void>>(stop);
  const done = superviseDesktop({
    child,
    stopServer,
    signals: { on: (signal, listener) => signals.on(signal, listener) },
    log: (line) => lines.push(line),
    forceQuitAfterMs: 1_000,
  });
  return { child, signals, lines, stopServer, done };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("electronBinary", () => {
  it("설치된 Electron 실행 파일 경로를 돌려준다", () => {
    expect(
      electronBinary(
        () => "/x/Electron",
        (path) => path === "/x/Electron",
      ),
    ).toEqual({
      ok: true,
      path: "/x/Electron",
    });
  });

  it("electron 패키지가 바이너리를 못 찾으면 설치 명령과 dev:web 을 알린다", () => {
    const thrown = electronBinary(
      () => {
        throw new Error("Electron failed to install correctly");
      },
      () => true,
    );
    const absent = electronBinary(
      () => "/x/Electron",
      () => false,
    );
    const notString = electronBinary(
      () => ({}),
      () => true,
    );
    for (const result of [thrown, absent, notString]) {
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.message).toContain(ELECTRON_INSTALL_COMMAND);
      expect(result.message).toContain("pnpm dev:web");
    }
  });
});

describe("desktopDevEnv", () => {
  it("개발 서버 주소와 개발 전용 앱 데이터·홈을 넘기고, Electron 을 Node 로 돌리지 않는다", () => {
    const env = desktopDevEnv(
      { PATH: "/bin", ELECTRON_RUN_AS_NODE: "1", GANGER_HOME: "/home/me/.ganger" },
      { url: "http://127.0.0.1:3000", devRoot: "/repo/.dev" },
    );
    expect(env).toEqual({
      PATH: "/bin",
      GANGER_DESKTOP_DEV_SERVER: "http://127.0.0.1:3000",
      GANGER_DESKTOP_USER_DATA: join("/repo/.dev", "desktop", "user-data"),
      GANGER_HOME: join("/repo/.dev", "desktop", "home"),
    });
  });
});

describe("superviseDesktop", () => {
  it("앱을 끝내면 개발 서버를 멈추고 0 으로 끝난다", async () => {
    const { child, stopServer, done, lines } = setup();
    child.emit("exit", 0);
    await expect(done).resolves.toBe(0);
    expect(stopServer).toHaveBeenCalledOnce();
    expect(child.signals).toEqual([]);
    expect(lines).toEqual(["[dev] desktop app quit, stopping the dev server"]);
  });

  it("앱이 오류 코드로 끝나면 개발 서버를 멈추고 그 코드를 돌려준다", async () => {
    const { child, stopServer, done } = setup();
    child.emit("exit", 3);
    await expect(done).resolves.toBe(3);
    expect(stopServer).toHaveBeenCalledOnce();
  });

  it("Ctrl+C 를 받으면 앱에 SIGTERM 을 보내고, 앱이 끝난 뒤 개발 서버를 멈춘다", async () => {
    const { child, signals, stopServer, done } = setup();
    signals.emit("SIGINT");
    signals.emit("SIGINT");
    expect(child.signals).toEqual(["SIGTERM"]);
    expect(stopServer).not.toHaveBeenCalled();
    child.emit("exit", null);
    await expect(done).resolves.toBe(0);
    expect(stopServer).toHaveBeenCalledOnce();
  });

  it("신호를 받고도 앱이 끝나지 않으면 SIGKILL 로 끝낸다", async () => {
    vi.useFakeTimers();
    const { child, signals, done } = setup();
    signals.emit("SIGTERM");
    vi.advanceTimersByTime(999);
    expect(child.signals).toEqual(["SIGTERM"]);
    vi.advanceTimersByTime(1);
    expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
    child.emit("exit", null);
    await expect(done).resolves.toBe(0);
  });

  it("앱을 띄우지 못하면 개발 서버를 멈추고 1 로 끝난다", async () => {
    const { child, stopServer, done, lines } = setup();
    child.emit("error", new Error("spawn ENOENT"));
    await expect(done).resolves.toBe(1);
    expect(stopServer).toHaveBeenCalledOnce();
    expect(lines).toEqual([
      "[dev] desktop app could not start (spawn ENOENT), stopping the dev server",
    ]);
  });

  it("개발 서버가 깨끗이 멈추지 않으면 1 로 끝난다", async () => {
    const { child, done } = setup(() => Promise.reject(new Error("port busy")));
    child.emit("exit", 0);
    await expect(done).resolves.toBe(1);
  });
});
