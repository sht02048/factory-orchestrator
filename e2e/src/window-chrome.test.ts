import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HIDDEN_TITLE_BAR, TITLE_BAR_COOKIE } from "@ganger/app/shell/window-chrome";
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
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));
const screenshotDir = process.env["WINDOW_CHROME_SCREENSHOTS"];

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
  dir = mkdtempSync(join(tmpdir(), "ganger-window-chrome-"));
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

const SCREENS = [
  { path: "/", name: shell.nav.dashboard, shot: "dashboard" },
  { path: "/runs", name: shell.nav.runs, shot: "runs" },
  { path: "/runners", name: shell.nav.runners, shot: "runners" },
] as const;

describe("창 제목 표시줄과 한 줄 머리(0113)", () => {
  it("웹 브라우저에서는 화면 제목이 머리 줄의 h1 로 그대로 읽히고, 레일 위 빈 자리와 끌기 영역이 없다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 800 });
    for (const screen of SCREENS) {
      await open(page, screen.path);
      const header = page.locator("main header").first();
      expect(await header.getByRole("heading", { level: 1 }).innerText()).toBe(screen.name);
      expect(await page.getByRole("heading", { level: 1 }).count()).toBe(1);
      expect(await page.locator("[data-window-controls]").count()).toBe(0);
      expect(await appRegions(page)).toEqual([]);
      const box = await header.boundingBox();
      expect(box?.y).toBe(0);
      expect(box?.height).toBeGreaterThanOrEqual(56);
      expect(await workspaceTop(page)).toBeLessThan(24);
      await screenshot(page, `web-${screen.shot}-1280`);
    }
  });

  it("데스크톱 앱 창(쿠키)에서는 레일 위 56px 을 비우고, 그 자리와 머리 줄을 끌기 영역으로 두며 안의 링크·버튼은 뺀다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 800 }, { desktop: true });
    for (const screen of SCREENS) {
      await open(page, screen.path);
      const header = page.locator("main header").first();
      expect(await header.getByRole("heading", { level: 1 }).innerText()).toBe(screen.name);
      const controls = await page.locator("[data-window-controls]").boundingBox();
      expect(controls).toEqual({ x: 0, y: 0, width: 84, height: 56 });
      expect(await region(page.locator("[data-window-controls]"))).toBe("drag");
      expect(await region(header)).toBe("drag");
      expect(await header.boundingBox()).toMatchObject({ x: 84, y: 0, height: 56 });
      for (const control of await header.locator("a, button, [role='tab']").all())
        expect(await region(control)).toBe("no-drag");
      expect(await workspaceTop(page)).toBeGreaterThanOrEqual(56);
      await screenshot(page, `desktop-${screen.shot}-1280`);
    }
  });

  it("좁은 폭(400px)에서도 제목이 읽히고 가로로 넘치지 않는다", async (context) => {
    const page = await newPage(context, { width: 400, height: 800 });
    await open(page, "/");
    expect(await page.getByRole("heading", { level: 1 }).innerText()).toBe(shell.nav.dashboard);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(400);
    await screenshot(page, "web-dashboard-400");
  });
});

async function appRegions(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("body *")]
      .map((element) => getComputedStyle(element).getPropertyValue("-webkit-app-region"))
      .filter((value) => value === "drag"),
  );
}

function region(locator: ReturnType<Page["locator"]>): Promise<string> {
  return locator.evaluate((element) =>
    getComputedStyle(element).getPropertyValue("-webkit-app-region"),
  );
}

async function workspaceTop(page: Page): Promise<number> {
  const box = await page
    .locator("aside > div:not([data-window-controls]) > *")
    .first()
    .boundingBox();
  return box?.y ?? Number.NaN;
}

async function screenshot(page: Page, name: string): Promise<void> {
  if (screenshotDir === undefined) return;
  mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: join(screenshotDir, `${name}.png`) });
}

async function newPage(
  context: TestContext,
  viewport: { width: number; height: number },
  { desktop = false }: { desktop?: boolean } = {},
): Promise<Page> {
  const browserContext = await browser.newContext({
    baseURL: baseUrl,
    locale: "ko-KR",
    timezoneId: "UTC",
    viewport,
  });
  if (desktop)
    await browserContext.addCookies([
      { name: TITLE_BAR_COOKIE, value: HIDDEN_TITLE_BAR, url: baseUrl },
    ]);
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
