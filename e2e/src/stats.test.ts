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
import type { Browser, BrowserContext, Page } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from "vitest";
import type { TestContext } from "vitest";
import runs from "../../apps/web/messages/ko/runs.json" with { type: "json" };
import stats from "../../apps/web/messages/ko/stats.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const runnerId = toRunnerId("runner-a");
const runnerProject = toRunnerProjectId("fake:acme/web");
const agent = toAgentId("claude");
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
  dir = mkdtempSync(join(tmpdir(), "ganger-stats-"));
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
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await web?.close();
  db?.$client.close();
  delete process.env["DATABASE_PATH"];
  delete process.env["ENCRYPTION_KEY"];
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

async function openPage(context: TestContext, width = 1280): Promise<Page> {
  const browserContext: BrowserContext = await browser.newContext({
    baseURL: baseUrl,
    locale: "ko-KR",
    timezoneId: "UTC",
    viewport: { width, height: 900 },
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

describe("Stats 기간(브라우저, 0072)", () => {
  it("기간을 7일로 바꾸면 숫자·차트가 그 7일로 바뀌고 바로 앞 7일과 비교한다", async (context) => {
    const page = await openPage(context);
    await page.goto(`/stats?ws=${workspaceId}`);
    await hydrated(page);

    const ended = page.getByRole("group", { name: stats.figures.ended });
    const mergedRate = page.getByRole("group", { name: stats.figures.mergedRate });
    const table = page.getByRole("table", { name: stats.throughput.tableCaption });
    expect(await ended.textContent()).toContain("2");
    expect(await table.getByRole("rowheader").count()).toBe(14);
    expect(await page.getByRole("heading", { level: 1 }).textContent()).toBe(
      "끝난 런 2개 중 50%를 에이전트가 병합까지 끝냈어요",
    );

    const periods = page.getByRole("tablist", { name: stats.period.label });
    await periods.getByRole("tab", { name: "7일" }).click();

    await page.waitForURL(/days=7/);
    await page
      .getByRole("heading", {
        level: 1,
        name: "끝난 런 1개 중 100%를 에이전트가 병합까지 끝냈어요",
      })
      .waitFor();
    expect(await ended.textContent()).toBe(`${stats.figures.ended}1`);
    expect(await mergedRate.textContent()).toContain("앞 7일보다 100%p 올랐어요");
    expect(await table.getByRole("rowheader").count()).toBe(7);
    expect(await periods.getByRole("tab", { name: "7일" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });
});

describe("Stats 날짜별 처리량(브라우저, 0053)", () => {
  it("키보드로 '표로 보기'를 누르면 날짜별 값 표가 화면에 보인다", async (context) => {
    const page = await openPage(context);

    await page.goto(`/stats?ws=${workspaceId}`);
    await hydrated(page);

    const today = new Intl.DateTimeFormat("ko-KR", {
      timeZone: "UTC",
      month: "long",
      day: "numeric",
    }).format(new Date());
    const table = page.getByRole("table", { name: stats.throughput.tableCaption });
    const todayRow = table
      .getByRole("row")
      .filter({ has: page.getByRole("rowheader", { name: today, exact: true }) });

    await table.waitFor({ state: "attached" });
    expect(await table.getByRole("rowheader").count()).toBe(14);
    const box = table.locator("xpath=ancestor::div[3]");
    expect((await box.boundingBox())?.height ?? 0).toBeLessThanOrEqual(1);

    await focusByTab(page, stats.throughput.showTable);
    await page.keyboard.press("Enter");

    await page.getByRole("button", { name: stats.throughput.hideTable }).waitFor();
    expect((await box.boundingBox())?.height ?? 0).toBeGreaterThan(100);
    expect(await todayRow.getByRole("cell").allTextContents()).toEqual(["1", "0", "0", "0"]);
  });
});

describe("Stats 나눠 보기에서 Runs 열기(브라우저, 0075)", () => {
  it("행을 누르면 그 러너와 Stats 기간으로 Runs 를 연다", async (context) => {
    const page = await openPage(context);
    await page.goto(`/stats?ws=${workspaceId}&days=7`);
    await hydrated(page);

    const breakdown = page.getByRole("table", { name: "러너별 끝난 런, 병합률, 리드 타임" });
    await breakdown
      .getByRole("row")
      .filter({ hasText: "runner-a" })
      .getByRole("cell")
      .first()
      .click();

    await page.waitForURL(/\/runs\?/);
    const search = new URL(page.url()).searchParams;
    expect(search.get("runner")).toBe("runner-a");
    expect(search.get("days")).toBe("7");
    expect(search.get("ws")).toBe(workspaceId);
    const conditions = page.getByRole("group", { name: runs.conditions.label });
    await conditions.getByRole("button", { name: "기간: 최근 7일 조건 지우기" }).waitFor();
    expect(await page.getByRole("option").allTextContents()).toEqual([
      expect.stringContaining("ACME-1"),
    ]);
  });

  it("키보드로 행 링크에 가서 Enter 를 누르면 그 조건으로 Runs 를 연다", async (context) => {
    const page = await openPage(context);
    await page.goto(`/stats?ws=${workspaceId}&by=trackerProject`);
    await hydrated(page);

    const link = page
      .getByRole("link", { name: stats.openRuns.replace("{name}", "Web") })
      .and(page.locator(":focus"));
    for (let i = 0; i < 80 && (await link.count()) === 0; i += 1) await page.keyboard.press("Tab");
    expect(await link.count()).toBe(1);
    await page.keyboard.press("Enter");

    await page.waitForURL(/\/runs\?/);
    expect(new URL(page.url()).searchParams.get("days")).toBe("14");
    const conditions = page.getByRole("group", { name: runs.conditions.label });
    await conditions.getByRole("button", { name: "프로젝트: Web 조건 지우기" }).waitFor();
    expect(await page.getByRole("option").count()).toBe(2);
  });
});

describe("Stats 배치(브라우저, 0093)", () => {
  async function layout(context: TestContext, width: number) {
    const page = await openPage(context, width);
    await page.goto(`/stats?ws=${workspaceId}`);
    await hydrated(page);
    const tiles = await page
      .getByRole("region", { name: stats.figures.label, exact: true })
      .getByRole("group")
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
    const chart = await page
      .getByRole("region", { name: stats.throughput.title, exact: true })
      .boundingBox();
    const failures = await page
      .getByRole("region", { name: stats.failures.title, exact: true })
      .boundingBox();
    const frame = await page.getByRole("heading", { level: 1 }).evaluate((h1) => {
      const header = h1.closest("header");
      return header?.parentElement?.getBoundingClientRect().width ?? 0;
    });
    await page.context().close();
    return {
      tileRows: new Set(tiles.map((top) => Math.round(top))).size,
      sideBySide: chart !== null && failures !== null && Math.abs(chart.y - failures.y) < 1,
      chartRatio: chart !== null && failures !== null ? chart.width / failures.width : 0,
      frame,
    };
  }

  it("넓으면 숫자 카드 가로 넷, 차트와 실패 이유는 1.4:1 로 나란히, 본문은 1100px 까지다", async (context) => {
    const wide = await layout(context, 1728);
    expect(wide.tileRows).toBe(1);
    expect(wide.sideBySide).toBe(true);
    expect(wide.chartRatio).toBeCloseTo(1.4, 1);
    expect(wide.frame).toBe(1100);
  });

  it("중간 폭은 숫자 카드 2×2, 차트와 실패 이유는 위아래로 쌓는다", async (context) => {
    const middle = await layout(context, 800);
    expect(middle.tileRows).toBe(2);
    expect(middle.sideBySide).toBe(false);
  });

  it("본문이 480px 이하일 때만 숫자 카드를 한 줄에 하나씩 둔다", async (context) => {
    expect((await layout(context, 640)).tileRows).toBe(2);
    expect((await layout(context, 400)).tileRows).toBe(4);
  });

  async function breakdownScroll(context: TestContext, width: number) {
    const page = await openPage(context, width);
    await page.goto(`/stats?ws=${workspaceId}`);
    await hydrated(page);
    const region = page.getByRole("region", {
      name: "러너별 끝난 런, 병합률, 리드 타임",
      exact: true,
    });
    const result = {
      hint: await page.getByText(stats.scrollHint).isVisible(),
      pageOverflow: await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
      region,
      page,
    };
    return result;
  }

  it("나눠 보기 표가 본문에 들어가면 스크롤 영역도 안내도 없다", async (context) => {
    const wide = await breakdownScroll(context, 1280);
    await expect.poll(() => wide.region.count()).toBe(0);
    expect([wide.hint, wide.pageOverflow]).toEqual([false, 0]);
    await wide.page.context().close();
  });

  it("나눠 보기 표가 본문보다 넓으면 표만 옆으로 넘어가고 키보드로 닿는 영역과 안내가 생긴다", async (context) => {
    const narrow = await breakdownScroll(context, 400);
    await expect.poll(() => narrow.region.count()).toBe(1);
    expect([narrow.hint, narrow.pageOverflow]).toEqual([true, 0]);
    expect(await narrow.region.getAttribute("tabindex")).toBe("0");
    const [scrollWidth, clientWidth] = await narrow.region.evaluate((el) => [
      el.scrollWidth,
      el.clientWidth,
    ]);
    expect(scrollWidth).toBeGreaterThan(clientWidth);
    await narrow.page.context().close();
  });
});

describe("Stats 날짜별 표(브라우저, 0093)", () => {
  it("좁은 폭에서 '표로 보기'로 펼친 표는 표만 옆으로 넘어가고 페이지는 넘치지 않는다", async (context) => {
    const page = await openPage(context, 400);
    await page.goto(`/stats?ws=${workspaceId}`);
    await hydrated(page);
    await page.getByRole("button", { name: stats.throughput.showTable }).click();
    await page.getByRole("region", { name: stats.throughput.tableCaption, exact: true }).waitFor();
    const scroller = await page.evaluate(() => {
      const h1 = document.querySelector("h1");
      let el: Element | null = h1;
      while (
        el !== null &&
        !(el.scrollHeight > el.clientHeight && getComputedStyle(el).overflow === "auto")
      )
        el = el.parentElement;
      return el === null ? 0 : el.scrollWidth - el.clientWidth;
    });
    expect(scroller).toBe(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0);
  });
});

describe("Stats 접힌 날짜별 표(브라우저, 0093)", () => {
  it("표를 접어 두면 '표로 보기' 다음 Tab 이 바로 'Failed 런 보기'로 간다", async (context) => {
    const page = await openPage(context);
    await page.goto(`/stats?ws=${workspaceId}`);
    await hydrated(page);
    await focusByTab(page, stats.throughput.showTable);
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe(
      stats.failures.openRuns,
    );
  });
});

describe("Stats 'Failed 런 보기'(브라우저, 0093)", () => {
  it("누르면 Failed 와 Stats 기간 조건으로 Runs 를 연다", async (context) => {
    const page = await openPage(context);
    await page.goto(`/stats?ws=${workspaceId}&days=30`);
    await hydrated(page);

    await page.getByRole("link", { name: stats.failures.openRuns }).click();

    await page.waitForURL(/\/runs\?/);
    const search = new URL(page.url()).searchParams;
    expect(search.get("f")).toBe("failed");
    expect(search.get("days")).toBe("30");
    expect(search.get("ws")).toBe(workspaceId);
    await page.getByRole("option").filter({ hasText: "ACME-2" }).waitFor();
    expect(await page.getByRole("option").allTextContents()).toEqual([
      expect.stringContaining("ACME-2"),
    ]);
  });
});

async function focusByTab(page: Page, name: string): Promise<void> {
  for (let i = 0; i < 80; i += 1) {
    await page.keyboard.press("Tab");
    const focused = page.getByRole("button", { name, exact: true }).and(page.locator(":focus"));
    if ((await focused.count()) === 1) return;
  }
  throw new Error(`Tab 으로 "${name}" 버튼에 가지 못했어요`);
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

  const key = toTicketKey("ACME-1");
  const assigned = assignRun(db, {
    ticket: { connection, key },
    trackerProject,
    runnerProject,
    agent,
    runnerId,
  });
  if (!assigned.ok) throw new Error(`assign ${key} failed: ${assigned.reason}`);
  ok(
    changeRunState(db, assigned.run.id, {
      to: "running",
      started: {
        worktree: toWorktreeRef("wt-acme-1"),
        branch: "acme/wt-acme-1",
        agentRef: toAgentRef("agent-wt-acme-1"),
      },
    }),
  );
  ok(
    changeRunState(db, assigned.run.id, {
      to: "ended",
      agentResult: "reported-success",
      prState: "merged",
    }),
  );
  seedEarlierFailure(db);
}

function seedEarlierFailure(db: Database): void {
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  const assigned = assignRun(db, {
    ticket: { connection, key: toTicketKey("ACME-2") },
    trackerProject,
    runnerProject,
    agent,
    runnerId,
    now: tenDaysAgo,
  });
  if (!assigned.ok) throw new Error(`assign ACME-2 failed: ${assigned.reason}`);
  ok(
    changeRunState(
      db,
      assigned.run.id,
      {
        to: "running",
        started: {
          worktree: toWorktreeRef("wt-acme-2"),
          branch: "acme/wt-acme-2",
          agentRef: toAgentRef("agent-wt-acme-2"),
        },
      },
      new Date(tenDaysAgo.getTime() + 60_000),
    ),
  );
  ok(
    changeRunState(
      db,
      assigned.run.id,
      { to: "ended", agentResult: "reported-failure", prState: "none" },
      new Date(tenDaysAgo.getTime() + 20 * 60_000),
    ),
  );
}

function ok(result: { ok: true } | { ok: false; error: unknown }): void {
  if (!result.ok) throw new Error(`state change failed: ${JSON.stringify(result.error)}`);
}

async function hydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await page.waitForLoadState("networkidle");
}
