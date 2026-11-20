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
import { serverFnName, waitForRouterIdle } from "./navigation-timing.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const routerModule = join(webRoot, "src/router.tsx");
const probeRoutesModule = join(webRoot, "src/testing/query-probe-routes.tsx");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const PROBE_PATH = "/query-probe";
const AWAY_PATH = "/query-probe-away";
const PROBE_SELECTOR = "#query-probe";
const AWAY_SELECTOR = "#query-probe-away";
const PROBE_SERVER_FN = "getTimeZone";
const ERROR_PATH = "/query-probe-error";
const SHELL_ERROR_PATH = "/query-probe-shell-error";
const PROBE_ERROR_MESSAGE = "query-probe-read-failed";
const RETRY_PATH = "/stats/query-probe-retry";
const HEAL_FLAG = "__gangerQueryProbeHealed";
const PRELOAD_FRESH_MS = 5_000;
const SETTLE_MS = 500;
const BROWSER_TIME_ZONE = "UTC";

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

const queryProbeRoutes: Plugin = {
  name: "e2e-query-probe-routes",
  enforce: "pre",
  resolveId(source, importer) {
    return importer === routerModule && source === "./routeTree.gen" ? probeRoutesModule : null;
  },
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ganger-query-cache-"));
  const dbPath = join(dir, "ganger.db");
  db = openDatabase(dbPath);
  migrate(db);
  seed(db);
  process.env["DATABASE_PATH"] = dbPath;
  process.env["ENCRYPTION_KEY"] = Buffer.from(encryptionKey).toString("base64");
  ({ server: web, baseUrl } = await startWebServer({
    plugins: [fakeAdapters, queryProbeRoutes],
    cacheDir: join(dir, "vite-cache"),
  }));
  browser = await chromium.launch({ channel: "chrome" });

  const warm = await browser.newPage({ baseURL: baseUrl, locale: "ko-KR" });
  warm.setDefaultTimeout(110_000);
  for (const path of [AWAY_PATH, PROBE_PATH, `/runs?ws=${workspaceId}`]) {
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

describe("요청별 QueryClient와 서버 렌더(0123)", () => {
  it.for([PROBE_PATH, "/runs", "/tickets"])(
    "서버 렌더한 %s 는 hydration이 끝날 때까지 서버 함수를 부르지 않는다",
    async (path, context) => {
      const { page, serverCalls } = await newPage(context);
      await page.goto(`${path}?ws=${workspaceId}`);
      await waitForRouterIdle(page, path);
      await page.waitForLoadState("networkidle");

      expect(serverCalls).toEqual([]);
    },
  );

  it("쿠키가 다른 동시 서버 렌더 요청은 서로의 값을 담지 않는다", async () => {
    const zones = ["Asia/Seoul", "Europe/Berlin", "America/New_York", "Australia/Sydney"];
    const rounds = 3;
    const requests = Array.from({ length: rounds }, () => zones).flat();

    const pages = await Promise.all(
      requests.map(async (zone) => {
        const response = await fetch(new URL(PROBE_PATH, baseUrl), {
          headers: { cookie: `tz=${encodeURIComponent(zone)}` },
        });
        return { zone, html: await response.text() };
      }),
    );

    for (const { zone, html } of pages) {
      expect(html.match(/id="query-probe"[^>]*>([^<]*)</)?.[1]).toBe(zone);
      expect(html).toMatch(/queryKey:\$R\[\d+\]=\["query-probe","time-zone"\]/);
      expect(html).toContain(`data:"${zone}"`);
      for (const other of zones.filter((candidate) => candidate !== zone)) {
        expect(html).not.toContain(other);
      }
    }
  });
});

describe("로더 도구와 0117 계약(0123)", () => {
  it("포인터를 올려 미리 읽은 화면은 누를 때 다시 읽지 않는다", async (context) => {
    const { page, serverCalls } = await newPage(context);
    await openAway(page);

    await routerCall(page, "preloadRoute", PROBE_PATH);
    expect(countOf(serverCalls, PROBE_SERVER_FN)).toBe(1);

    await routerCall(page, "navigate", PROBE_PATH);
    await waitForProbe(page);
    await page.waitForTimeout(SETTLE_MS);
    expect(countOf(serverCalls, PROBE_SERVER_FN)).toBe(1);
  });

  it("미리 읽은 지 5초가 지난 뒤 들어가면 캐시로 그리고 뒤에서 새로 읽는다", async (context) => {
    const { page, serverCalls } = await newPage(context);
    await openAway(page);

    await routerCall(page, "preloadRoute", PROBE_PATH);
    expect(countOf(serverCalls, PROBE_SERVER_FN)).toBe(1);
    await page.waitForTimeout(PRELOAD_FRESH_MS + SETTLE_MS);

    await routerCall(page, "navigate", PROBE_PATH);
    await waitForProbe(page);
    await expect.poll(() => countOf(serverCalls, PROBE_SERVER_FN)).toBe(2);
  });

  it("서버 렌더로 연 화면을 떠났다가 1~2초 안에 돌아오면 뒤에서 새로 읽는다", async (context) => {
    const { page, serverCalls } = await newPage(context);
    await page.goto(PROBE_PATH);
    await waitForProbe(page);
    await page.waitForLoadState("networkidle");
    expect(countOf(serverCalls, PROBE_SERVER_FN)).toBe(0);

    await routerCall(page, "navigate", AWAY_PATH);
    await page.locator(AWAY_SELECTOR).waitFor();
    await routerCall(page, "navigate", PROBE_PATH);
    await waitForProbe(page);

    await expect.poll(() => countOf(serverCalls, PROBE_SERVER_FN)).toBe(1);
  });

  it("한 번 본 화면은 다시 들어갈 때 기다리지 않고 그린 뒤 뒤에서 새로 읽는다", async (context) => {
    const { page, serverCalls } = await newPage(context);
    await openAway(page);
    await routerCall(page, "navigate", PROBE_PATH);
    await waitForProbe(page);
    expect(countOf(serverCalls, PROBE_SERVER_FN)).toBe(1);

    await routerCall(page, "navigate", AWAY_PATH);
    await page.locator(AWAY_SELECTOR).waitFor();
    await page.waitForTimeout(PRELOAD_FRESH_MS + SETTLE_MS);
    await routerCall(page, "navigate", PROBE_PATH);
    await waitForProbe(page);

    await expect.poll(() => countOf(serverCalls, PROBE_SERVER_FN)).toBe(2);
  });
});

describe("query 읽기 실패(0123 할 일 10)", () => {
  it("실패한 query는 retry 1번 뒤 라우터 match와 같은 오류 객체로 서버 렌더 HTML에 실린다", async () => {
    const response = await fetch(new URL(ERROR_PATH, baseUrl));
    const html = await response.text();

    expect(response.status).toBe(500);
    const matchError = html.match(/e:\$R\[(\d+)\]=new Error\("([^"]*)"\)/);
    expect(matchError?.[2]).toBe(PROBE_ERROR_MESSAGE);
    const errorRef = `$R[${matchError?.[1] ?? ""}]`;
    expect(html).toContain(`error:${errorRef},`);
    expect(html).toContain(`fetchFailureCount:2,fetchFailureReason:${errorRef},`);
  });

  it("셸 안 화면의 query가 throw하면 서버 렌더와 hydration 뒤 모두 레일을 남기고 화면 칸에만 오류를 그린다", async (context) => {
    const response = await fetch(new URL(SHELL_ERROR_PATH, baseUrl));
    const html = await response.text();
    expect(html).toContain(`aria-label="${shell.nav.label}"`);
    expect(html).toContain(shell.screenError.title);

    const { page } = await newPage(context);
    await page.goto(SHELL_ERROR_PATH);
    await page.getByRole("heading", { name: shell.screenError.title }).waitFor();
    await page.waitForLoadState("networkidle");

    expect(await page.getByRole("navigation", { name: shell.nav.label }).count()).toBe(1);
    expect(await page.getByRole("button", { name: shell.screenError.retry }).count()).toBe(1);
  });

  it("셸 안 화면으로 옮기다 query가 throw해도 레일은 남고, 오류 화면 머리로 포커스가 옮겨 가며 다시 읽기 단추가 보인다", async (context) => {
    const { page } = await newPage(context);
    await openRuns(page);

    await routerCall(page, "navigate", SHELL_ERROR_PATH);
    await page.getByRole("heading", { name: shell.screenError.title }).waitFor();

    expect(await page.getByRole("navigation", { name: shell.nav.label }).count()).toBe(1);
    expect(await page.getByRole("button", { name: shell.screenError.retry }).count()).toBe(1);
    await expect.poll(() => focusedHeadingText(page)).toBe(shell.screenError.title);
  });

  it("다시 읽기를 누르면 실패했던 화면만 다시 읽고, 읽히면 오류 화면이 화면으로 바뀌며 포커스는 레일의 지금 화면 링크로 간다", async (context) => {
    const { page, serverCalls } = await newPage(context);
    await openRuns(page);
    await routerCall(page, "navigate", RETRY_PATH);
    await page.getByRole("heading", { name: shell.screenError.title }).waitFor();
    await page.waitForLoadState("networkidle");
    const callsBeforeRetry = serverCalls.length;

    await page.evaluate((flag) => Reflect.set(window, flag, true), HEAL_FLAG);
    await page.getByRole("button", { name: shell.screenError.retry }).click();

    await page.locator(PROBE_SELECTOR).filter({ hasText: RETRY_PATH }).waitFor();
    expect(await page.getByRole("navigation", { name: shell.nav.label }).count()).toBe(1);
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-current") ?? null))
      .toBe("page");
    await page.waitForLoadState("networkidle");
    expect(serverCalls.slice(callsBeforeRetry)).toEqual([]);
  });

  it("다시 읽기가 또 실패하면 실패를 알리는 상태 문장으로 포커스를 옮긴다", async (context) => {
    const { page } = await newPage(context);
    await openRuns(page);
    await routerCall(page, "navigate", RETRY_PATH);
    await page.getByRole("heading", { name: shell.screenError.title }).waitFor();

    await page.getByRole("button", { name: shell.screenError.retry }).click();

    await page.getByRole("status").filter({ hasText: shell.screenError.retryFailed }).waitFor();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.textContent ?? null))
      .toBe(shell.screenError.retryFailed);
    expect(await page.getByRole("navigation", { name: shell.nav.label }).count()).toBe(1);
  });

  it("다시 읽기가 실패한 뒤 다른 화면에 갔다 돌아와 또 실패하면 지난 실패 문장은 남지 않는다", async (context) => {
    const { page } = await newPage(context);
    await openRuns(page);
    await routerCall(page, "navigate", RETRY_PATH);
    await page.getByRole("heading", { name: shell.screenError.title }).waitFor();
    await page.getByRole("button", { name: shell.screenError.retry }).click();
    await page.getByRole("status").filter({ hasText: shell.screenError.retryFailed }).waitFor();

    await routerCall(page, "navigate", "/runs");
    await waitForRouterIdle(page, "/runs");
    await routerCall(page, "navigate", RETRY_PATH);
    await page.getByRole("heading", { name: shell.screenError.title }).waitFor();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(SETTLE_MS);

    expect(await page.getByText(shell.screenError.retryFailed).count()).toBe(0);
  });
});

function focusedHeadingText(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.querySelector("h1")?.textContent ?? null);
}

async function openRuns(page: Page): Promise<void> {
  await page.goto(`/runs?ws=${workspaceId}`);
  await waitForRouterIdle(page, "/runs");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("navigation", { name: shell.nav.label }).count()).resolves.toBe(1);
}

async function newPage(context: TestContext): Promise<{ page: Page; serverCalls: string[] }> {
  const browserContext = await browser.newContext({
    baseURL: baseUrl,
    locale: "ko-KR",
    timezoneId: BROWSER_TIME_ZONE,
    viewport: { width: 1280, height: 800 },
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

function countOf(serverCalls: ReadonlyArray<string>, name: string): number {
  return serverCalls.filter((call) => call === name).length;
}

async function openAway(page: Page): Promise<void> {
  await page.goto(AWAY_PATH);
  await page.locator(AWAY_SELECTOR).waitFor();
  await waitForRouterIdle(page, AWAY_PATH);
  await page.waitForLoadState("networkidle");
}

async function waitForProbe(page: Page): Promise<void> {
  await page.locator(PROBE_SELECTOR).waitFor();
  await waitForRouterIdle(page, PROBE_PATH);
}

async function routerCall(
  page: Page,
  method: "navigate" | "preloadRoute",
  to: string,
): Promise<void> {
  await page.evaluate(
    async ([name, path]) => {
      const router: unknown = Reflect.get(window, "__TSR_ROUTER__");
      if (typeof router !== "object" || router === null) throw new Error("no router on window");
      const call: unknown = Reflect.get(router, name);
      if (typeof call !== "function") throw new Error(`router has no ${name}`);
      const result: unknown = Reflect.apply(call, router, [{ to: path }]);
      await result;
    },
    [method, to] as const,
  );
}

function seed(database: Database): void {
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
}
