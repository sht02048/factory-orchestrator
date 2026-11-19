import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DESKTOP_NAVIGATION_GLOBAL, navShortcuts } from "@ganger/app/shell/nav-shortcuts";
import {
  toAgentId,
  toCodeHostKind,
  toLabelId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTrackerStateId,
} from "@ganger/core";
import {
  SecretBox,
  migrate,
  openDatabase,
  recordRunnerCheck,
  saveAutoAssignLabel,
  saveCodeHostConnection,
  saveMapping,
  saveRunner,
  saveTrackerConnection,
  saveWorkspace,
  saveWorkspaceTrackerProject,
  toCodeHostConnectionId,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from "vitest";
import type { TestContext } from "vitest";
import shell from "../../apps/web/messages/ko/shell.json" with { type: "json" };
import tickets from "../../apps/web/messages/ko/tickets.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));
const screenshotDir = process.env["NAV_SHORTCUTS_SCREENSHOTS"];

const runnerId = toRunnerId("runner-a");
const runnerProject = toRunnerProjectId("fake:acme/web");
const encryptionKey = new Uint8Array(32).fill(7);

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;

const fakeAdapters: Plugin = {
  name: "e2e-fake-adapters",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (importer === undefined || !source.endsWith("/adapters")) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved?.id === adaptersModule ? fakeAdaptersModule : null;
  },
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ganger-nav-shortcuts-"));
  const dbPath = join(dir, "ganger.db");
  db = openDatabase(dbPath);
  migrate(db);
  seed(db);
  process.env["DATABASE_PATH"] = dbPath;
  process.env["ENCRYPTION_KEY"] = Buffer.from(encryptionKey).toString("base64");
  ({ server: web, baseUrl } = await startWebServer({
    plugins: [fakeAdapters],
    cacheDir: join(dir, "vite-cache"),
  }));
  browser = await chromium.launch({ channel: "chrome" });

  const warm = await browser.newPage({ baseURL: baseUrl, locale: "ko-KR" });
  warm.setDefaultTimeout(110_000);
  await open(warm, "/");
  await warm.close();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await web?.close();
  db?.$client.close();
  delete process.env["DATABASE_PATH"];
  delete process.env["ENCRYPTION_KEY"];
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

describe("화면 이동 단축키(브라우저, 0102)", () => {
  it("Mod+1~5, Mod+, 를 누르면 문서를 다시 읽지 않고 레일 순서대로 화면을 옮기고 Workspace 를 지킨다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 800 });
    await open(page, "/runs");
    await markDocument(page);

    for (const item of navShortcuts) {
      await page.keyboard.press(playwrightKey(item.hotkey));
      await page.waitForURL((url) => url.pathname === item.path);
      const link = page.getByRole("link", { name: shell.nav[item.screen], exact: true });
      expect(await link.getAttribute("aria-current")).toBe("page");
      expect(new URL(page.url()).searchParams.get("ws")).toBe(workspaceId);
    }
    expect(await documentMarked(page)).toBe(true);
  });

  it("입력칸에 글을 쓰다가 눌러도 레일을 누른 것처럼 바로 옮긴다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 800 });
    await open(page, "/tickets");
    const search = page.getByRole("searchbox", { name: tickets.search.label });
    await search.fill("ACME");
    await search.focus();

    await page.keyboard.press("ControlOrMeta+3");
    await page.waitForURL((url) => url.pathname === "/runs");
    expect(new URL(page.url()).searchParams.get("ws")).toBe(workspaceId);

    await open(page, "/tickets");
    await page.getByRole("searchbox", { name: tickets.search.label }).focus();
    await page.keyboard.press("ControlOrMeta+,");
    await page.waitForURL((url) => url.pathname === "/settings");
    expect(new URL(page.url()).pathname).toBe("/settings");
  });

  it("레일 링크는 키를 aria-keyshortcuts 로 알리고, 툴팁에 이름과 키를 함께 보인다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 800 });
    await open(page, "/");
    const isMac = await page.evaluate(() => /Mac/.test(navigator.platform));
    for (const item of navShortcuts) {
      const link = page.getByRole("link", { name: shell.nav[item.screen], exact: true });
      expect(await link.getAttribute("aria-keyshortcuts")).toBe(
        item.hotkey.replace("Mod", isMac ? "Meta" : "Control"),
      );
    }

    await page.getByRole("link", { name: shell.nav.runs, exact: true }).hover();
    const tooltip = page.getByRole("tooltip").filter({ hasText: shell.nav.runs });
    await tooltip.waitFor();
    expect((await tooltip.innerText()).replace(/[⁦⁩\s]/g, "")).toBe(
      `${shell.nav.runs}${isMac ? "⌘3" : "Ctrl+3"}`,
    );
    if (screenshotDir !== undefined) {
      mkdirSync(screenshotDir, { recursive: true });
      await page.screenshot({ path: join(screenshotDir, "rail-tooltip-1280.png") });
    }
  });

  it("데스크톱 앱 안에서는 키를 앱 메뉴에 맡기고, 메뉴가 보낸 화면으로 옮긴다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 800 });
    await page.addInitScript((name) => {
      const listeners: Array<(screen: unknown) => void> = [];
      Object.assign(globalThis, {
        [name]: {
          onNavigate: (listener: (screen: unknown) => void) => {
            listeners.push(listener);
            return () => listeners.splice(listeners.indexOf(listener), 1);
          },
        },
      });
      addEventListener("menu-sends", (event) => {
        if (event instanceof CustomEvent) for (const listener of listeners) listener(event.detail);
      });
    }, DESKTOP_NAVIGATION_GLOBAL);
    await open(page, "/runs");
    await markDocument(page);

    await page.keyboard.press("ControlOrMeta+2");
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 1_000 }).toBe("/runs");

    const menuSends = (screen: string) =>
      page.evaluate((detail) => dispatchEvent(new CustomEvent("menu-sends", { detail })), screen);
    await menuSends("stats");
    await page.waitForURL((url) => url.pathname === "/stats");
    await menuSends("onboarding");
    await menuSends("runs");
    await page.waitForURL((url) => url.pathname === "/runs");
    expect(new URL(page.url()).searchParams.get("ws")).toBe(workspaceId);
    expect(await documentMarked(page)).toBe(true);
  });
});

function playwrightKey(hotkey: string): string {
  return hotkey.replace(/^Mod\+/, "ControlOrMeta+");
}

async function markDocument(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.assign(globalThis, { navShortcutsDocumentMarker: true });
  });
}

function documentMarked(page: Page): Promise<boolean> {
  return page.evaluate(() => "navShortcutsDocumentMarker" in globalThis);
}

async function newPage(
  context: TestContext,
  viewport: { width: number; height: number },
): Promise<Page> {
  const browserContext = await browser.newContext({
    baseURL: baseUrl,
    locale: "ko-KR",
    timezoneId: "UTC",
    viewport,
  });
  const page = await browserContext.newPage();
  page.setDefaultTimeout(30_000);
  onTestFailed(async () => {
    mkdirSync(resultsDir, { recursive: true });
    const name = context.task.name.replace(/[^\p{L}\p{N}_-]+/gu, "-");
    await page.screenshot({ path: join(resultsDir, `${name}.png`), fullPage: true });
  });
  return page;
}

async function open(page: Page, path: string): Promise<void> {
  await page.goto(`${path}?ws=${workspaceId}`);
  await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await page.waitForLoadState("networkidle");
}

function seed(db: Database): void {
  saveTrackerConnection(db, new SecretBox(encryptionKey), {
    id: connection,
    kind: fakeKind,
    name: "Acme",
    config: {},
    secrets: { apiKey: "secret" },
  });
  saveCodeHostConnection(db, new SecretBox(encryptionKey), {
    id: toCodeHostConnectionId("github"),
    kind: toCodeHostKind("github"),
    name: "github",
    config: {},
    secrets: { token: "github_pat_example" },
  });
  saveWorkspace(db, { id: workspaceId, name: "Acme" });
  saveWorkspaceTrackerProject(db, {
    workspaceId,
    connection,
    projectId: trackerProject,
    name: "Web",
    inProgressStateId: toTrackerStateId("in-progress"),
  });
  saveMapping(db, { connection, trackerProject, runnerProject, agent: toAgentId("claude") });
  saveAutoAssignLabel(db, { workspaceId, connection, labelId: toLabelId("factory") });
  saveRunner(db, {
    id: runnerId,
    kind: toRunnerKind("fake"),
    name: "runner-a",
    config: {},
    capacity: 4,
  });
  recordRunnerCheck(db, {
    runnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects: [{ id: runnerProject, displayName: "acme/web", setupState: "ready" as const }],
    assignmentBlocked: false,
  });
}
