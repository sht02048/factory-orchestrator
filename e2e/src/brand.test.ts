/// <reference lib="dom" />

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  toAgentId,
  toCodeHostKind,
  toLabelId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTrackerStateId,
} from "@factory/core";
import {
  SecretBox,
  migrate,
  openDatabase,
  saveAutoAssignLabel,
  saveCodeHostConnection,
  saveMapping,
  saveRunner,
  saveTrackerConnection,
  saveWorkspace,
  saveWorkspaceTrackerProject,
  toCodeHostConnectionId,
} from "@factory/db";
import type { Database } from "@factory/db";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed } from "vitest";
import notFound from "../../apps/web/messages/ko/notFound.json" with { type: "json" };
import shell from "../../apps/web/messages/ko/shell.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const encryptionKey = new Uint8Array(32).fill(7);

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let page: Page;

const fakeAdapters: Plugin = {
  name: "e2e-brand-fake-adapters",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (importer === undefined || !source.endsWith("/adapters")) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved?.id === adaptersModule ? fakeAdaptersModule : null;
  },
};

function seedFinishedSetup(database: Database): void {
  const box = new SecretBox(encryptionKey);
  saveTrackerConnection(database, box, {
    id: connection,
    kind: fakeKind,
    name: "Acme",
    config: {},
    secrets: { apiKey: "secret" },
  });
  saveCodeHostConnection(database, box, {
    id: toCodeHostConnectionId("github"),
    kind: toCodeHostKind("github"),
    name: "github",
    config: {},
    secrets: { token: "github_pat_example" },
  });
  saveWorkspace(database, { id: workspaceId, name: "Acme" });
  saveWorkspaceTrackerProject(database, {
    workspaceId,
    connection,
    projectId: trackerProject,
    name: "Web",
    inProgressStateId: toTrackerStateId("in-progress"),
  });
  saveMapping(database, {
    connection,
    trackerProject,
    runnerProject: toRunnerProjectId("fake:acme/web"),
    agent: toAgentId("claude"),
  });
  saveAutoAssignLabel(database, { workspaceId, connection, labelId: toLabelId("factory") });
  saveRunner(database, {
    id: toRunnerId("runner-a"),
    kind: toRunnerKind("fake"),
    name: "runner-a",
    config: {},
    capacity: 2,
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "factory-brand-"));
  const dbPath = join(dir, "factory.db");
  db = openDatabase(dbPath);
  migrate(db);
  seedFinishedSetup(db);

  process.env["DATABASE_PATH"] = dbPath;
  process.env["ENCRYPTION_KEY"] = Buffer.from(encryptionKey).toString("base64");
  ({ server: web, baseUrl } = await startWebServer({
    plugins: [fakeAdapters],
    cacheDir: join(dir, "vite-cache"),
  }));

  browser = await chromium.launch({ channel: "chrome" });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await web?.close();
  db?.$client.close();
  delete process.env["DATABASE_PATH"];
  delete process.env["ENCRYPTION_KEY"];
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

beforeEach(async (test) => {
  page = await browser.newPage({ baseURL: baseUrl, locale: "ko-KR" });
  page.setDefaultTimeout(110_000);
  const current = page;
  onTestFailed(async () => {
    mkdirSync(resultsDir, { recursive: true });
    const name = test.task.name.replace(/[^\p{L}\p{N}_-]+/gu, "-");
    await current.screenshot({ path: join(resultsDir, `${name}.png`), fullPage: true });
  });
  return () => current.close();
});

describe("브랜드(티켓 0077)", () => {
  it("파비콘·터치 아이콘을 head 에 걸고 그 파일을 내준다", async () => {
    await page.goto("/");
    const links = await page
      .locator('head link[rel="icon"], head link[rel="apple-touch-icon"]')
      .evaluateAll((elements) =>
        elements.map((element) => `${element.getAttribute("rel")} ${element.getAttribute("href")}`),
      );
    expect(links).toEqual([
      "icon /favicon.ico",
      "icon /icon.svg",
      "apple-touch-icon /apple-touch-icon.png",
    ]);
    for (const [path, type] of [
      ["/favicon.ico", /icon/],
      ["/icon.svg", /svg/],
      ["/apple-touch-icon.png", /png/],
    ] as const) {
      const response = await page.request.get(path);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toMatch(type);
    }
  }, 120_000);

  it("레일 맨 위에 제품 기호가 있고 그 아래 Workspace 바꾸기가 온다", async () => {
    await page.goto("/");
    const rail = page.locator("aside").first();
    const mark = rail.getByRole("img", { name: shell.brand });
    await expect.poll(() => mark.count()).toBe(1);
    const switcher = rail.getByRole("button", { name: /Workspace 바꾸기/ });
    const markBox = await mark.boundingBox();
    const switcherBox = await switcher.boundingBox();
    expect(markBox).not.toBeNull();
    expect(switcherBox).not.toBeNull();
    expect((markBox?.y ?? 0) + (markBox?.height ?? 0)).toBeLessThanOrEqual(switcherBox?.y ?? 0);
  }, 120_000);

  it("없는 주소는 걱정하는 반장과 안내를 보이고, 반장은 화면 읽기에서 숨는다", async () => {
    await page.goto("/no-such-screen");
    await expect.poll(() => page.getByText(notFound.title).count()).toBe(1);
    const mascot = page.locator('svg[data-mascot="worried"]');
    expect(await mascot.isVisible()).toBe(true);
    expect(await mascot.getAttribute("aria-hidden")).toBe("true");
    const snapshot = await page.locator("main").ariaSnapshot();
    expect(snapshot).toContain(notFound.title);
    expect(snapshot).toContain(notFound.home);
    expect(snapshot).not.toMatch(/\bimg\b/);
  }, 120_000);
});
