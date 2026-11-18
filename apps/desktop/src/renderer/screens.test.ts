/// <reference lib="dom" />

import { mkdtempSync, rmSync } from "node:fs";
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
