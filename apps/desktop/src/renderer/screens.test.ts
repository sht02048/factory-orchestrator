/// <reference lib="dom" />

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import screens from "../../messages/ko/screens.json" with { type: "json" };
import type { DesktopApi, ViewState } from "../shared/view.js";

type Transitions = Partial<Record<keyof DesktopApi, ViewState>>;

const desktopRoot = fileURLToPath(new URL("../..", import.meta.url));

let dir: string;
let server: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let page: Page;

function installFakeDesktop({ first, next }: { first: ViewState; next: Transitions }) {
  let view = first;
  const listeners = new Set<(view: ViewState) => void>();
  const move = (method: keyof DesktopApi) => () => {
    const target = next[method];
    if (target !== undefined) {
      view = target;
      for (const listener of listeners) listener(view);
    }
    return Promise.resolve();
  };
  const api: DesktopApi = {
    getView: () => Promise.resolve(view),
    onView: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    chooseLocal: move("chooseLocal"),
    chooseRemote: move("chooseRemote"),
    findServers: move("findServers"),
    connectFound: move("connectFound"),
    showAddress: move("showAddress"),
    connectAddress: move("connectAddress"),
    startLocal: move("startLocal"),
    retry: move("retry"),
    chooseMode: move("chooseMode"),
    openLog: move("openLog"),
    acceptEnrollment: move("acceptEnrollment"),
    cancelEnrollment: move("cancelEnrollment"),
    closeEnrollment: move("closeEnrollment"),
    openSharing: move("openSharing"),
  };
  window.desktop = api;
}

async function openScreen(first: ViewState, next: Transitions = {}): Promise<void> {
  await page.addInitScript(installFakeDesktop, { first, next });
  await page.goto(baseUrl);
}

async function focusedHeading(): Promise<string | null> {
  return page.evaluate(() => {
    const active = document.activeElement;
    return active?.tagName === "H1" ? active.textContent : null;
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "desktop-renderer-"));
  server = await createServer({
    configFile: join(desktopRoot, "vite.renderer.config.ts"),
    root: join(desktopRoot, "src/renderer"),
    cacheDir: join(dir, "vite-cache"),
    logLevel: "silent",
    server: { port: 0, host: "127.0.0.1" },
  });
  await server.listen();
  const address = server.resolvedUrls?.local[0];
  if (address === undefined) throw new Error("renderer dev server has no address");
  baseUrl = address;
  browser = await chromium.launch({ channel: "chrome" });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  page = await browser.newPage({ locale: "ko-KR" });
  page.setDefaultTimeout(30_000);
});

afterEach(async () => {
  await page.close();
});

describe("데스크톱 화면 전환 포커스(브라우저, 0062)", () => {
  it("서버 찾기를 눌러 화면이 바뀌면 포커스가 새 화면 제목으로 간다", async () => {
    await openScreen(
      { screen: "choose-mode" },
      { chooseRemote: { screen: "find-servers", port: 3000, searching: true, result: null } },
    );
    await page.getByRole("button", { name: screens.chooseMode.remote.action }).click();
    await expect.poll(focusedHeading).toBe(screens.find.title);
  });

  it("서버 켜기를 눌러 화면이 바뀌면 포커스가 새 화면 제목으로 간다", async () => {
    await openScreen({ screen: "local-stopped" }, { startLocal: { screen: "local-starting" } });
    await page.getByRole("button", { name: screens.local.start }).click();
    await expect.poll(focusedHeading).toBe(screens.local.startingTitle);
  });

  it("다시 시도로 실패 화면에서 멈춤 화면으로 바뀌어도 포커스가 새 제목으로 간다", async () => {
    await openScreen(
      { screen: "local-failed", logFile: "/tmp/acme/server.log" },
      { retry: { screen: "local-stopped" } },
    );
    await page.getByRole("button", { name: screens.local.retry }).click();
    await expect.poll(focusedHeading).toBe(screens.local.stoppedTitle);
  });

  it("같은 화면 안에서 다시 찾기를 눌러도 포커스는 누른 버튼에 남는다", async () => {
    await openScreen(
      { screen: "find-servers", port: 3000, searching: false, result: { kind: "missing" } },
      { findServers: { screen: "find-servers", port: 3000, searching: true, result: null } },
    );
    const refresh = page.getByRole("button", { name: screens.find.refresh });
    await refresh.click();
    await expect.poll(() => refresh.getAttribute("aria-disabled")).toBe("true");
    expect(await refresh.evaluate((button) => button === document.activeElement)).toBe(true);
  });
});

describe("서버 바꾸기 화면(브라우저, 0083)", () => {
  it("앱 업데이트 뒤 ②를 바꾸는 동안 반장과 버전, 런이 이어진다는 안내를 status 로 보인다", async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openScreen({ screen: "local-updating", from: "0.1.0", to: "0.2.0" });
    await expect.poll(focusedHeading).toBe(screens.updating.title);
    const status = page.getByRole("status");
    expect(await status.innerText()).toContain("0.1.0 → 0.2.0");
    expect(await status.innerText()).toContain(screens.updating.runs);
    expect(await page.locator('[data-mascot="signal"]').count()).toBe(1);
    const shots = process.env["UPDATE_SCREENSHOTS"];
    if (shots !== undefined) {
      mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: join(shots, "updating-1280.png") });
    }
  });

  it("버전을 모르면 버전 없이 안내한다", async () => {
    await openScreen({ screen: "local-updating", from: null, to: null });
    expect(await page.getByRole("status").innerText()).toContain(screens.updating.summary);
  });
});

const START = { done: [], waitingForRemoteLogin: false, github: null, problem: null } as const;

describe("이 맥을 러너로 등록하기(브라우저, 0099)", () => {
  it("요청은 붙은 서버 이름, 직접 할 일, 할 일 단계와 등록·취소를 보이고, 등록을 누르면 진행 화면 제목으로 포커스가 간다", async () => {
    await openScreen(
      {
        screen: "runner-enrollment",
        server: "mac-mini",
        enrollment: { phase: "ask", accepting: false },
      },
      {
        acceptEnrollment: {
          screen: "runner-enrollment",
          server: "mac-mini",
          enrollment: {
            phase: "running",
            progress: { ...START, done: ["remoteLogin"] },
            canceling: false,
          },
        },
      },
    );
    await expect.poll(focusedHeading).toBe(screens.enrollment.askTitle);
    await page.getByText("mac-mini의 Ganger가 이 맥에서 에이전트를 돌려요.").waitFor();
    await page.getByText(screens.enrollment.youBody).waitFor();
    const steps = page.getByRole("list", { name: screens.enrollment.stepsLabel });
    expect(await steps.getByRole("listitem").count()).toBe(5);
    await page.getByRole("button", { name: screens.enrollment.cancel }).waitFor();

    await page.getByRole("button", { name: screens.enrollment.register }).click();
    await expect.poll(focusedHeading).toBe(screens.enrollment.runningTitle);
    await steps.getByText(screens.enrollment.state.running).waitFor();
    await page
      .getByRole("status")
      .filter({ hasText: "Ganger 키 등록 진행 중" })
      .waitFor({ state: "attached" });
  });

  it("원격 로그인을 기다리는 동안 켜는 곳을 알리고 공유 설정을 열 수 있다", async () => {
    await openScreen({
      screen: "runner-enrollment",
      server: "mac-mini",
      enrollment: {
        phase: "running",
        progress: { ...START, waitingForRemoteLogin: true },
        canceling: false,
      },
    });
    await page
      .getByRole("status")
      .filter({ hasText: screens.enrollment.remoteLoginWaitTitle })
      .waitFor();
    await page.getByRole("button", { name: screens.enrollment.openSharing }).waitFor();
    const steps = page.getByRole("list", { name: screens.enrollment.stepsLabel });
    expect(await steps.getByText(screens.enrollment.state.running).count()).toBe(1);
  });

  it("실패는 이유와 멈춘 단계를 보이고, 만료는 서버 화면으로 돌아가는 길을 둔다", async () => {
    await openScreen(
      {
        screen: "runner-enrollment",
        server: "mac-mini",
        enrollment: {
          phase: "failed",
          progress: { ...START, done: ["remoteLogin", "key"], problem: "service-failed" },
        },
      },
      {
        closeEnrollment: {
          screen: "runner-enrollment",
          server: "mac-mini",
          enrollment: { phase: "gone", reason: "expired" },
        },
      },
    );
    await expect.poll(focusedHeading).toBe(screens.enrollment.failedTitle);
    await page.getByText(screens.enrollment.problem["service-failed"], { exact: false }).waitFor();
    const steps = page.getByRole("list", { name: screens.enrollment.stepsLabel });
    await steps.getByText(screens.enrollment.state.failed).waitFor();
    await page.getByRole("button", { name: screens.enrollment.backToServer }).click();
    await expect.poll(focusedHeading).toBe(screens.enrollment.goneTitle);
    await page.getByText(screens.enrollment.gone.expired).waitFor();
  });
});

describe("등록 끝 화면(브라우저, 0099)", () => {
  it("GitHub 정리를 건너뛰었으면 그 줄에 건너뛰었다고 쓰고, 서버 화면으로 돌아가는 버튼을 둔다", async () => {
    await openScreen({
      screen: "runner-enrollment",
      server: "mac-mini",
      enrollment: {
        phase: "registered",
        progress: {
          ...START,
          done: ["remoteLogin", "key", "service", "github", "register"],
          github: "gh-logged-out",
        },
      },
    });
    await expect.poll(focusedHeading).toBe(screens.enrollment.registeredTitle);
    const steps = page.getByRole("list", { name: screens.enrollment.stepsLabel });
    expect(await steps.getByText(screens.enrollment.state.skipped).count()).toBe(1);
    await page.getByText(screens.enrollment.github["gh-logged-out"]).waitFor();
    await page.getByRole("button", { name: screens.enrollment.backToServer }).waitFor();
  });
});

describe("서버에 알리는 중에는 취소를 막기(브라우저, 0099)", () => {
  it("GitHub 단계가 끝나면 취소 버튼을 못 쓰게 한다", async () => {
    await openScreen({
      screen: "runner-enrollment",
      server: "mac-mini",
      enrollment: {
        phase: "running",
        progress: { ...START, done: ["remoteLogin", "key", "service", "github"] },
        canceling: false,
      },
    });
    const cancel = page.getByRole("button", { name: screens.enrollment.cancel });
    expect(await cancel.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("이 맥에서 취소한 등록(브라우저, 0099)", () => {
  it("취소는 문제로 칠하지 않고 어느 단계도 실패로 표시하지 않는다", async () => {
    await openScreen({
      screen: "runner-enrollment",
      server: "mac-mini",
      enrollment: {
        phase: "failed",
        progress: { ...START, done: ["remoteLogin"], problem: "canceled" },
      },
    });
    await expect.poll(focusedHeading).toBe(screens.enrollment.canceledTitle);
    const steps = page.getByRole("list", { name: screens.enrollment.stepsLabel });
    expect(await steps.getByText(screens.enrollment.state.failed).count()).toBe(0);
    expect(await steps.getByRole("img", { name: screens.enrollment.state.failed }).count()).toBe(0);
  });
});
