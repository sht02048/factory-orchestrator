import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  toAgentId,
  toAgentRef,
  toCodeHostKind,
  toLabelId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTicketKey,
  toTrackerStateId,
  toWorktreeRef,
} from "@factory/core";
import {
  SecretBox,
  assignRun,
  changeRunState,
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
} from "@factory/db";
import type { Database } from "@factory/db";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import { createServer } from "vite";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from "vitest";
import type { TestContext } from "vitest";
import runsJson from "../../apps/web/messages/ko/runs.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const onlineRunner = toRunnerId("runner-a");
const offlineRunner = toRunnerId("runner-b");
const runnerProject = toRunnerProjectId("fake:acme/web");
const agent = toAgentId("claude");
const encryptionKey = new Uint8Array(32).fill(7);
const runningKey = "ACME-RUN";
const endedRunCount = 55;
const endedPageSize = 50;

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
  dir = mkdtempSync(join(tmpdir(), "factory-runs-"));
  const dbPath = join(dir, "factory.db");
  db = openDatabase(dbPath);
  migrate(db);
  seed(db);

  process.env["DATABASE_PATH"] = dbPath;
  process.env["ENCRYPTION_KEY"] = Buffer.from(encryptionKey).toString("base64");
  web = await createServer({
    root: webRoot,
    configFile: join(webRoot, "vite.config.ts"),
    logLevel: "warn",
    plugins: [fakeAdapters],
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: null },
  });
  await web.listen();
  const address = web.httpServer?.address();
  if (address === null || address === undefined || typeof address === "string") {
    throw new Error("web dev server has no TCP address");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;

  browser = await chromium.launch({ channel: "chrome" });

  const warm = await browser.newPage({ baseURL: baseUrl, locale: "ko-KR" });
  warm.setDefaultTimeout(110_000);
  await openRuns(warm);
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

describe("Runs 화면(브라우저, 0056)", () => {
  it("'자세히 보기'를 누르면 문서를 다시 읽지 않고 Run 상세로 간다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 900 });
    await openRuns(page);
    await page.getByRole("option", { name: runningKey }).click();
    await page.evaluate(() => {
      Object.assign(globalThis, { runsDocumentMarker: true });
    });

    await page.getByRole("link", { name: runsJson.panel.openDetail }).click();
    await page.waitForURL(/\/runs\/[^/?]+/);
    await page.getByRole("heading", { name: runningKey }).first().waitFor();

    expect(await page.evaluate(() => "runsDocumentMarker" in globalThis)).toBe(true);
  });

  it("끝난 런은 최근 50개만 보이고, '더 보기'를 누르면 더 읽고 포커스를 잃지 않는다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 900 });
    await openRuns(page);
    const endedRows = page.getByRole("option", { name: /^ACME-END-/ });
    expect(await endedRows.count()).toBe(endedPageSize);
    await page
      .getByRole("status")
      .filter({ hasText: runsJson.ended.partial.replace("{count}", String(endedPageSize)) })
      .waitFor();

    await page.getByRole("button", { name: runsJson.ended.showMore }).click();
    await page
      .getByRole("status")
      .filter({ hasText: runsJson.ended.all.replace("{count}", String(endedRunCount)) })
      .waitFor();

    expect(await endedRows.count()).toBe(endedRunCount);
    expect(await page.getByRole("button", { name: runsJson.ended.showMore }).count()).toBe(0);
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe(
      runsJson.ended.all.replace("{count}", String(endedRunCount)),
    );
  });

  it("800px 폭에서는 목록이 무너지지 않고 패널이 목록 아래로 내려간다", async (context) => {
    const page = await newPage(context, { width: 800, height: 900 });
    await openRuns(page);
    const list = page.getByRole("listbox", { name: runsJson.listLabel });
    const panel = page.getByRole("region", { name: runsJson.panel.label });
    const listBox = await list.boundingBox();
    const panelBox = await panel.boundingBox();
    if (listBox === null || panelBox === null) throw new Error("list or panel is not visible");

    expect(listBox.width).toBeGreaterThan(500);
    expect(panelBox.y).toBeGreaterThanOrEqual(listBox.y);
    expect(panelBox.width).toBeGreaterThan(500);
  });

  it("레일의 Runner Issue 점은 글자와 바탕의 대비가 4.5:1 이상이다", async (context) => {
    const page = await newPage(context, { width: 1280, height: 900 });
    await openRuns(page);
    const dot = page.locator("[data-issues]");
    expect(await dot.textContent()).toBe("1");

    const ratio = await dot.evaluate((element) => {
      const style = getComputedStyle(element);
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context2d = canvas.getContext("2d", { willReadFrequently: true });
      if (context2d === null) throw new Error("no 2d context");
      const luminance = (color: string): number => {
        context2d.clearRect(0, 0, 1, 1);
        context2d.fillStyle = color;
        context2d.fillRect(0, 0, 1, 1);
        const [r = 0, g = 0, b = 0] = context2d.getImageData(0, 0, 1, 1).data;
        const linear = (channel: number) => {
          const c = channel / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
      };
      const text = luminance(style.color);
      const background = luminance(style.backgroundColor);
      return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

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

async function openRuns(page: Page): Promise<void> {
  await page.goto(`/runs?ws=${workspaceId}`);
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
  saveMapping(db, { connection, trackerProject, runnerProject, agent });
  saveAutoAssignLabel(db, { workspaceId, connection, labelId: toLabelId("factory") });
  for (const [id, online] of [
    [onlineRunner, true],
    [offlineRunner, false],
  ] as const) {
    saveRunner(db, { id, kind: toRunnerKind("fake"), name: id, config: {}, capacity: 4 });
    recordRunnerCheck(db, {
      runnerId: id,
      online,
      checkedAt: new Date(),
      error: null,
      projects: [{ id: runnerProject, displayName: "acme/web", setupState: "ready" as const }],
      assignmentBlocked: false,
    });
  }

  const start = Date.now() - (endedRunCount + 10) * 60_000;
  for (let i = 0; i < endedRunCount; i += 1) {
    const at = new Date(start + i * 60_000);
    const id = assign(db, `ACME-END-${i}`, at);
    ok(changeRunState(db, id, { to: "ended", agentResult: "canceled", prState: "none" }, at));
  }
  const running = assign(db, runningKey, new Date());
  ok(
    changeRunState(db, running, {
      to: "running",
      started: {
        worktree: toWorktreeRef("wt-acme-run"),
        branch: "acme/wt-acme-run",
        agentRef: toAgentRef("agent-wt-acme-run"),
      },
    }),
  );
}

function assign(db: Database, key: string, now: Date) {
  const assigned = assignRun(db, {
    ticket: { connection, key: toTicketKey(key) },
    trackerProject,
    runnerProject,
    agent,
    runnerId: onlineRunner,
    now,
  });
  if (!assigned.ok) throw new Error(`assign ${key} failed: ${assigned.reason}`);
  return assigned.run.id;
}

function ok(result: { ok: true } | { ok: false; error: unknown }): void {
  if (!result.ok) throw new Error(`state change failed: ${JSON.stringify(result.error)}`);
}
