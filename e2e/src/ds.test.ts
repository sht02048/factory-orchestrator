import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate, openDatabase } from "@ganger/db";
import type { Database } from "@ganger/db";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from "vitest";
import ds from "../../apps/web/messages/ko/ds.json" with { type: "json" };
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

const fakeAdapters: Plugin = {
  name: "e2e-ds-fake-adapters",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (importer === undefined || !source.endsWith("/adapters")) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved?.id === adaptersModule ? fakeAdaptersModule : null;
  },
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ganger-ds-"));
  const dbPath = join(dir, "ganger.db");
  db = openDatabase(dbPath);
  migrate(db);

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

describe("/ds SegmentedTabs 키보드(브라우저, 0073)", () => {
  it("화살표 키로 탭을 옮기면 포커스와 선택이 함께 옮고, 양 끝에서 반대 끝으로 돈다", async (context) => {
    const page = await openPage(context.task.name);
    await page.goto("/ds");
    await hydrated(page);

    const list = page.getByRole("tablist", { name: ds.segmented.periodLabel });
    const selected = () => list.getByRole("tab", { selected: true }).textContent();
    const focused = () => page.evaluate(() => document.activeElement?.textContent ?? null);

    await list.getByRole("tab", { name: new RegExp(`^${ds.segmented.days7}`) }).click();
    await expect.poll(selected).toMatch(new RegExp(`^${ds.segmented.days7}`));

    await page.keyboard.press("ArrowRight");
    await expect.poll(selected).toMatch(new RegExp(`^${ds.segmented.days14}`));
    await expect.poll(focused).toMatch(new RegExp(`^${ds.segmented.days14}`));

    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect.poll(selected).toMatch(new RegExp(`^${ds.segmented.days30}`));
    await expect.poll(focused).toMatch(new RegExp(`^${ds.segmented.days30}`));

    await page.keyboard.press("ArrowRight");
    await expect.poll(selected).toMatch(new RegExp(`^${ds.segmented.days7}`));
    await page.keyboard.press("ArrowLeft");
    await expect.poll(selected).toMatch(new RegExp(`^${ds.segmented.days30}`));

    await expect
      .poll(() =>
        list
          .getByRole("tab")
          .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("tabindex"))),
      )
      .toEqual(["-1", "-1", "0"]);
  });
});

async function openPage(testName: string): Promise<Page> {
  const browserContext = await browser.newContext({
    baseURL: baseUrl,
    locale: "ko-KR",
    viewport: { width: 1280, height: 900 },
  });
  const page = await browserContext.newPage();
  page.setDefaultTimeout(30_000);
  onTestFailed(async () => {
    mkdirSync(resultsDir, { recursive: true });
    const name = testName.replace(/[^\p{L}\p{N}_-]+/gu, "-");
    await page.screenshot({ path: join(resultsDir, `${name}.png`), fullPage: true });
  });
  return page;
}

async function hydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await page.waitForLoadState("networkidle");
}
