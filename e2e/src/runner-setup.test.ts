import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { toCodeHostKind } from "@ganger/core";
import {
  SecretBox,
  listRunners,
  migrate,
  openDatabase,
  saveCodeHostConnection,
  saveTrackerConnection,
  toCodeHostConnectionId,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed } from "vitest";
import runnerSetup from "../../apps/web/messages/ko/runnerSetup.json" with { type: "json" };
import { connection, fakeKind } from "./browser/fixtures.js";
import { resetFakeThisMac } from "./browser/fake-this-mac.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const encryptionKey = new Uint8Array(32).fill(7);
const thisMac = runnerSetup.thisMac;

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let page: Page;

const fakeAdapters: Plugin = {
  name: "e2e-runner-setup-adapters",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (importer === undefined || !source.endsWith("/adapters")) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved?.id === adaptersModule ? fakeAdaptersModule : null;
  },
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ganger-runner-setup-"));
  const dbPath = join(dir, "ganger.db");
  db = openDatabase(dbPath);
  migrate(db);
  const box = new SecretBox(encryptionKey);
  saveTrackerConnection(db, box, {
    id: connection,
    kind: fakeKind,
    name: "Acme",
    config: {},
    secrets: { apiKey: "lin_api_example" },
  });
  saveCodeHostConnection(db, box, {
    id: toCodeHostConnectionId("github"),
    kind: toCodeHostKind("github"),
    name: "github",
    config: {},
    secrets: { token: "github_pat_example" },
  });

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

beforeEach(async (context) => {
  page = await browser.newPage({ baseURL: baseUrl, locale: "ko-KR" });
  page.setDefaultTimeout(30_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const current = page;
  onTestFailed(async () => {
    mkdirSync(resultsDir, { recursive: true });
    const name = context.task.name.replace(/[^\p{L}\p{N}_-]+/gu, "-");
    await current.screenshot({ path: join(resultsDir, `${name}.png`), fullPage: true });
  });
});

async function focused(): Promise<string | null> {
  const active = page.locator(":focus");
  return (await active.count()) === 0 ? null : active.first().textContent();
}

describe("이 맥을 러너로(브라우저, 0095)", () => {
  it("원격 로그인이 켜질 때까지 기다렸다가 단계를 돌리고, 등록한 러너가 아래에 나타나며 포커스가 그 제목에 간다", async () => {
    const mac = resetFakeThisMac();
    await page.goto("/onboarding?step=3");
    await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);

    const facts = page.getByRole("region", { name: runnerSetup.server.title });
    await facts.getByText("studio-mac").waitFor();
    await facts.getByText(runnerSetup.server.remoteLoginOff).waitFor();

    const steps = page.getByRole("list", { name: runnerSetup.choose.stepsLabel });
    await steps.getByText("직접 해요: 원격 로그인 켜기").waitFor({ state: "attached" });
    expect(await steps.getByRole("listitem").count()).toBe(5);
    expect(
      await page.getByRole("radio", { name: /이 맥\(studio-mac\)에서 돌리기/ }).isChecked(),
    ).toBe(true);
    const manual = page.locator("details").filter({ hasText: runnerSetup.choose.manual });
    expect(await manual.evaluate((el) => el.hasAttribute("open"))).toBe(false);

    await page.getByRole("button", { name: runnerSetup.choose.continue }).click();
    await expect.poll(focused).toBe(thisMac.title);
    await page.getByText(thisMac.remoteLoginBody).waitFor();
    await page.getByText(thisMac.waiting).waitFor();
    expect(mac.ran).toEqual([]);

    const flow = page.getByRole("region", { name: thisMac.title });
    const flowTop = await flow.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);

    mac.remoteLogin = true;
    await expect.poll(focused, { timeout: 15_000 }).toBe("studio-mac 러너");
    expect(mac.ran).toEqual(["key", "hostKey", "service", "github", "register"]);
    await flow.getByText(thisMac.problem["gh-logged-out"]).waitFor();
    await page
      .getByRole("status")
      .filter({ hasText: "studio-mac을(를) 러너로 등록했어요" })
      .waitFor();

    const after = await flow.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    expect(after).toBe(flowTop);
    const result = page.getByRole("region", { name: "studio-mac 러너" });
    const resultTop = await result.evaluate((el) => el.getBoundingClientRect().top);
    const flowBottom = await flow.evaluate((el) => el.getBoundingClientRect().bottom);
    expect(resultTop).toBeGreaterThan(flowBottom);

    const [runner] = listRunners(db);
    expect(runner?.capacity).toBe(1);
    expect(runner?.config).toMatchObject({
      sshTarget: "ganger@localhost",
      access: { kind: "ganger" },
    });
  });

  it("400px 에서도 고르기 화면이 가로로 넘치지 않는다", async () => {
    resetFakeThisMac();
    await page.setViewportSize({ width: 400, height: 844 });
    await page.goto("/onboarding?step=3");
    await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
    await page.getByText(runnerSetup.choose.question).waitFor();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
