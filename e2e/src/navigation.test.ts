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
} from "@ganger/core";
import type { RunId } from "@ganger/core";
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
} from "@ganger/db";
import type { Database } from "@ganger/db";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from "vitest";
import type { TestContext } from "vitest";
import domain from "../../apps/web/messages/ko/domain.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { TRACKER_DELAY_MS } from "./browser/slow-tracker-adapters.js";
import { navigateByRail, serverFnName, waitForScreen } from "./navigation-timing.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const slowAdaptersModule = fileURLToPath(
  new URL("./browser/slow-tracker-adapters.ts", import.meta.url),
);
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const runnerId = toRunnerId("runner-a");
const runnerProject = toRunnerProjectId("fake:acme/web");
const encryptionKey = new Uint8Array(32).fill(7);
const watchedTicket = toTicketKey("ACME-7");

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let watchedRun: RunId;

const slowAdapters: Plugin = {
  name: "e2e-slow-tracker-adapters",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (importer === undefined || !source.endsWith("/adapters")) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved?.id === adaptersModule ? slowAdaptersModule : null;
  },
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ganger-navigation-"));
  const dbPath = join(dir, "ganger.db");
  db = openDatabase(dbPath);
  migrate(db);
  watchedRun = seed(db);
  process.env["DATABASE_PATH"] = dbPath;
  process.env["ENCRYPTION_KEY"] = Buffer.from(encryptionKey).toString("base64");
  ({ server: web, baseUrl } = await startWebServer({
    plugins: [slowAdapters],
    cacheDir: join(dir, "vite-cache"),
  }));
  browser = await chromium.launch({ channel: "chrome" });

  const warm = await browser.newPage({ baseURL: baseUrl, locale: "ko-KR" });
  warm.setDefaultTimeout(110_000);
  for (const path of ["/runs", "/tickets", "/"]) {
    await warm.goto(`${path}?ws=${workspaceId}`);
    await warm.waitForLoadState("networkidle");
  }
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

describe("레일로 화면 옮기기(브라우저, 0117)", () => {
  it("레일 링크에 포인터를 올리면 그 화면을 미리 읽어, 누를 때 느린 트래커를 기다리지 않는다", async (context) => {
    const page = await newPage(context);
    await open(page, "/runs", "runs");

    const preloaded = page.waitForResponse(
      (response) => serverFnName(response.url()) === "getTicketsPage",
    );
    await page.getByRole("link", { name: /^Tickets/ }).hover();
    await (await preloaded).finished();

    const sample = await navigateByRail(page, "tickets", "first");
    expect(sample.ms).toBeLessThan(TRACKER_DELAY_MS);
  });

  it("한 번 본 화면은 다시 들어갈 때 지난 내용을 바로 그리고 뒤에서 새로 읽는다", async (context) => {
    const page = await newPage(context);
    await open(page, "/tickets", "tickets");
    await navigateByRail(page, "runs", "first");
    await page.mouse.move(0, 0);

    const again = await navigateByRail(page, "tickets", "again");
    expect(again.ms).toBeLessThan(TRACKER_DELAY_MS);
    expect(again.serverCalls.map((call) => call.name)).toContain("getTicketsPage");
  });

  it("다시 들어간 화면은 그사이 바뀐 런 상태를 반영한다", async (context) => {
    const page = await newPage(context);
    await open(page, "/runs", "runs");
    const row = page.getByRole("option").filter({ hasText: watchedTicket });
    await expect.poll(() => row.innerText()).toContain(domain.runState.queued);

    await navigateByRail(page, "dashboard", "first");
    start(db, watchedRun);
    await navigateByRail(page, "runs", "again");

    await expect.poll(() => row.innerText()).toContain(domain.runState.running);
  });
});

function start(database: Database, id: RunId): void {
  const change = changeRunState(
    database,
    id,
    {
      to: "running",
      started: {
        worktree: toWorktreeRef("wt-acme-7"),
        branch: "acme/acme-7",
        agentRef: toAgentRef("agent-acme-7"),
      },
    },
    new Date(),
  );
  if (!change.ok) throw new Error(JSON.stringify(change));
}

async function newPage(context: TestContext): Promise<Page> {
  const browserContext = await browser.newContext({
    baseURL: baseUrl,
    locale: "ko-KR",
    timezoneId: "UTC",
    viewport: { width: 1280, height: 800 },
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

async function open(page: Page, path: string, screen: "runs" | "tickets"): Promise<void> {
  await page.goto(`${path}?ws=${workspaceId}`);
  await waitForScreen(page, screen);
  await page.waitForLoadState("networkidle");
}

function seed(database: Database): RunId {
  saveTrackerConnection(database, new SecretBox(encryptionKey), {
    id: connection,
    kind: fakeKind,
    name: "Acme",
    config: {},
    secrets: { apiKey: "secret" },
  });
  saveCodeHostConnection(database, new SecretBox(encryptionKey), {
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
    runnerProject,
    agent: toAgentId("claude"),
  });
  saveAutoAssignLabel(database, { workspaceId, connection, labelId: toLabelId("factory") });
  saveRunner(database, {
    id: runnerId,
    kind: toRunnerKind("fake"),
    name: "runner-a",
    config: {},
    capacity: 4,
  });
  recordRunnerCheck(database, {
    runnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects: [{ id: runnerProject, displayName: "acme/web", setupState: "ready" as const }],
    assignmentBlocked: false,
  });
  const assigned = assignRun(database, {
    ticket: { connection, key: watchedTicket },
    trackerProject,
    runnerProject,
    agent: toAgentId("claude"),
    runnerId,
  });
  if (!assigned.ok) throw new Error(assigned.reason);
  return assigned.run.id;
}
