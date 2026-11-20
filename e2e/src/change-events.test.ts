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
  latestChangeSeq,
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
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { serverFnName, waitForRouterIdle } from "./navigation-timing.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const routerModule = join(webRoot, "src/router.tsx");
const probeRoutesModule = join(webRoot, "src/testing/query-probe-routes.tsx");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const RUN_PROBE_PATH = "/query-probe-run";
const RUN_PROBE_SELECTOR = "#query-probe-run";
const ANSWER_PROBE_PATH = "/query-probe-answer";
const ANSWER_PROBE_SELECTOR = "#query-probe-answer";
const PROBE_SERVER_FN = "getTimeZone";
const STREAM_PATH = "/api/change-events/stream";
const VISIBLE_WITHIN_MS = 3_000;
const BROWSER_TIME_ZONE = "UTC";

const runnerId = toRunnerId("runner-a");
const runnerProject = toRunnerProjectId("fake:acme/web");
const encryptionKey = new Uint8Array(32).fill(7);

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let runId: RunId;

const fakeAdapters: Plugin = {
  name: "e2e-fake-adapters",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (importer === undefined || !source.endsWith("/adapters")) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved?.id === adaptersModule ? fakeAdaptersModule : null;
  },
};

const queryProbeRoutes: Plugin = {
  name: "e2e-query-probe-routes",
  enforce: "pre",
  resolveId(source, importer) {
    return importer === routerModule && source === "./routeTree.gen" ? probeRoutesModule : null;
  },
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ganger-change-events-"));
  const dbPath = join(dir, "ganger.db");
  db = openDatabase(dbPath);
  migrate(db);
  runId = seed(db);
  process.env["DATABASE_PATH"] = dbPath;
  process.env["ENCRYPTION_KEY"] = Buffer.from(encryptionKey).toString("base64");
  ({ server: web, baseUrl } = await startWebServer({
    plugins: [fakeAdapters, queryProbeRoutes],
    cacheDir: join(dir, "vite-cache"),
  }));
  browser = await chromium.launch({ channel: "chrome" });

  const warm = await browser.newPage({ baseURL: baseUrl, locale: "ko-KR" });
  warm.setDefaultTimeout(110_000);
  for (const path of [RUN_PROBE_PATH, ANSWER_PROBE_PATH]) {
    await warm.goto(path);
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

describe("변경 기록 통로(브라우저, 0124)", () => {
  it("첫 연결은 서버 렌더가 넘긴 번호로 이어 받는다", async (context) => {
    const { page } = await newPage(context);
    const rendered = latestChangeSeq(db);
    const stream = page.waitForRequest((request) => isStream(request.url()));
    await page.goto(RUN_PROBE_PATH);

    expect(new URL((await stream).url()).searchParams.get("after")).toBe(String(rendered));
  });

  it("worker와 같은 함수로 런 상태를 바꾸면 3초 안에 그 런의 key를 다시 읽는다", async (context) => {
    const { page, serverCalls } = await newPage(context);
    await openRunProbe(page);
    expect(countOf(serverCalls, PROBE_SERVER_FN)).toBe(0);

    const changedAt = Date.now();
    const moved = changeRunState(db, runId, {
      to: "running",
      started: {
        worktree: toWorktreeRef("fake::/wt/1"),
        branch: "acme/ganger-ACME-1-1",
        agentRef: toAgentRef("agent-1"),
      },
    });
    expect(moved.ok).toBe(true);

    await expect
      .poll(() => countOf(serverCalls, PROBE_SERVER_FN), { timeout: VISIBLE_WITHIN_MS })
      .toBe(1);
    expect(Date.now() - changedAt).toBeLessThan(VISIBLE_WITHIN_MS);
  });

  it("서버 함수가 throw한 답 거절은 경계를 넘어도 이유를 지켜 같은 오류 타입이 된다", async (context) => {
    const { page } = await newPage(context);
    await page.goto(ANSWER_PROBE_PATH);
    const probe = page.locator(ANSWER_PROBE_SELECTOR);
    await expect.poll(() => probe.innerText()).not.toBe("pending");

    expect(JSON.parse(await probe.innerText())).toMatchObject({
      name: "MutationRejectedError",
      reason: "not-found",
      causeReason: null,
    });
  });
});

async function newPage(context: TestContext): Promise<{ page: Page; serverCalls: string[] }> {
  const browserContext = await browser.newContext({
    baseURL: baseUrl,
    locale: "ko-KR",
    timezoneId: BROWSER_TIME_ZONE,
  });
  await browserContext.addCookies([{ name: "tz", value: BROWSER_TIME_ZONE, url: baseUrl }]);
  const page = await browserContext.newPage();
  page.setDefaultTimeout(30_000);
  const serverCalls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/_serverFn/")) serverCalls.push(serverFnName(request.url()));
  });
  onTestFailed(async () => {
    mkdirSync(resultsDir, { recursive: true });
    const name = context.task.name.replace(/[^\p{L}\p{N}_-]+/gu, "-");
    await page.screenshot({ path: join(resultsDir, `${name}.png`), fullPage: true });
  });
  return { page, serverCalls };
}

async function openRunProbe(page: Page): Promise<void> {
  const streamReady = page.waitForResponse((response) => isStream(response.url()));
  await page.goto(RUN_PROBE_PATH);
  await page.locator(RUN_PROBE_SELECTOR).waitFor();
  await waitForRouterIdle(page, RUN_PROBE_PATH);
  await streamReady;
}

function isStream(url: string): boolean {
  return new URL(url).pathname === STREAM_PATH;
}

function countOf(serverCalls: ReadonlyArray<string>, name: string): number {
  return serverCalls.filter((call) => call === name).length;
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
  saveMapping(database, { connection, trackerProject, runnerProject, agent: toAgentId("claude") });
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
    ticket: { connection, key: toTicketKey("ACME-1") },
    trackerProject,
    runnerProject,
    agent: toAgentId("claude"),
    runnerId,
  });
  if (!assigned.ok) throw new Error(assigned.reason);
  return assigned.run.id;
}
