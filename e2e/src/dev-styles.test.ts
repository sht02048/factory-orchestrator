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
  name: "e2e-dev-styles-fake-adapters",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (importer === undefined || !source.endsWith("/adapters")) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved?.id === adaptersModule ? fakeAdaptersModule : null;
  },
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ganger-dev-styles-"));
  const dbPath = join(dir, "ganger.db");
  db = openDatabase(dbPath);
  migrate(db);

  process.env["DATABASE_PATH"] = dbPath;
  process.env["ENCRYPTION_KEY"] = Buffer.from(encryptionKey).toString("base64");
  ({ server: web, baseUrl } = await startWebServer({
    plugins: [fakeAdapters],
    cacheDir: join(dir, "vite-cache"),
    hmr: true,
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

describe("개발 서버의 StyleX CSS(브라우저, 0139)", () => {
  it("처음 연 화면에서 다른 화면으로 옮겨 가도 새 화면의 StyleX 규칙이 모두 붙는다", async (context) => {
    const page = await openPage(context.task.name);
    await page.goto("/ds");
    await hydrated(page);
    await expect.poll(() => classesWithoutRules(page)).toEqual([]);

    await navigateInApp(page, "/onboarding");
    await expect.poll(() => new URL(page.url()).pathname).toBe("/onboarding");
    await page.waitForLoadState("networkidle");

    await expect.poll(() => classesWithoutRules(page), { timeout: 15_000 }).toEqual([]);
  });
});

async function navigateInApp(page: Page, to: string): Promise<void> {
  await page.evaluate(async (target) => {
    const router: unknown = Reflect.get(globalThis, "__TSR_ROUTER__");
    if (typeof router !== "object" || router === null) throw new Error("router is missing");
    const navigate: unknown = Reflect.get(router, "navigate");
    if (typeof navigate !== "function") throw new Error("router.navigate is missing");
    const navigation: unknown = Reflect.apply(navigate, router, [{ to: target }]);
    await navigation;
  }, to);
}

async function classesWithoutRules(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    let css = "";
    for (const sheet of Array.from(document.styleSheets)) {
      if (sheet.disabled) continue;
      for (const rule of Array.from(sheet.cssRules)) css += rule.cssText;
    }
    const used = new Set<string>();
    for (const element of Array.from(document.querySelectorAll("body [class]"))) {
      for (const name of element.classList) {
        if (/^x[0-9a-z]{5,}$/.test(name)) used.add(name);
      }
    }
    return [...used].filter((name) => !css.includes(`.${name}`)).sort();
  });
}

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
