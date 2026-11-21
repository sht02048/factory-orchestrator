/// <reference lib="dom" />

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  toAgentId,
  toAgentRef,
  toCodeHostKind,
  toLabelId,
  toQuestionId,
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
  answerRunQuestion,
  assignRun,
  changeRunState,
  migrate,
  openDatabase,
  recordRunQuestions,
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
import type { Browser, Locator, Page } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from "vitest";
import type { TestContext } from "vitest";
import home from "../../apps/web/messages/ko/home.json" with { type: "json" };
import runs from "../../apps/web/messages/ko/runs.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { waitForRouterIdle } from "./navigation-timing.js";
import { startWebServer } from "./web-server.js";

interface MotionCall {
  key: string | null;
  properties: string[];
  pill: boolean;
}

declare global {
  var screenMotionCalls: MotionCall[];
  var screenMotionRate: number;
}

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const CHANGE_VISIBLE_MS = 15_000;
const QUIET_MS = 400;
const runnerId = toRunnerId("runner-a");
const runnerProject = toRunnerProjectId("fake:acme/web");
const agent = toAgentId("claude");
const encryptionKey = new Uint8Array(32).fill(7);

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let nextTicket = 100;

const fakeAdapters: Plugin = {
  name: "e2e-screen-motion-fake-adapters",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (importer === undefined || !source.endsWith("/adapters")) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved?.id === adaptersModule ? fakeAdaptersModule : null;
  },
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ganger-screen-motion-"));
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
  for (const path of [dashboardPath, runsPath]) {
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

const dashboardPath = `/?ws=${workspaceId}`;
const runsPath = `/runs?ws=${workspaceId}`;

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
  saveMapping(database, { connection, trackerProject, runnerProject, agent });
  saveAutoAssignLabel(database, { workspaceId, connection, labelId: toLabelId("factory") });
  saveRunner(database, {
    id: runnerId,
    kind: toRunnerKind("fake"),
    name: "runner-a",
    config: {},
    capacity: 100,
  });
  recordRunnerCheck(database, {
    runnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects: [{ id: runnerProject, displayName: "acme/web", setupState: "ready" }],
    assignmentBlocked: false,
  });
}

function assign(): { id: RunId; key: string } {
  const key = `ACME-${nextTicket++}`;
  const assigned = assignRun(db, {
    ticket: { connection, key: toTicketKey(key) },
    trackerProject,
    runnerProject,
    agent,
    runnerId,
  });
  if (!assigned.ok) throw new Error(`assign ${key} failed: ${assigned.reason}`);
  return { id: assigned.run.id, key };
}

function start(run: RunId): void {
  const worktree = `wt-${run}`;
  const changed = changeRunState(db, run, {
    to: "running",
    started: {
      worktree: toWorktreeRef(worktree),
      branch: `acme/${worktree}`,
      agentRef: toAgentRef(`agent-${worktree}`),
    },
  });
  if (!changed.ok) throw new Error(`start failed: ${JSON.stringify(changed.error)}`);
}

function pause(run: RunId): void {
  const changed = changeRunState(db, run, { to: "waiting-for-input" });
  if (!changed.ok) throw new Error(`wait failed: ${JSON.stringify(changed.error)}`);
}

async function newPage(
  context: TestContext,
  reducedMotion: "reduce" | "no-preference" = "no-preference",
): Promise<Page> {
  const browserContext = await browser.newContext({
    baseURL: baseUrl,
    locale: "ko-KR",
    reducedMotion,
    timezoneId: "UTC",
    viewport: { width: 1440, height: 1000 },
  });
  await browserContext.addCookies([{ name: "tz", value: "UTC", url: baseUrl }]);
  const page = await browserContext.newPage();
  page.setDefaultTimeout(30_000);
  await page.addInitScript(() => {
    const calls: MotionCall[] = [];
    // oxlint-disable-next-line typescript/unbound-method
    const original = Element.prototype.animate;
    Element.prototype.animate = function animate(keyframes, options) {
      calls.push({
        key: this.closest("[data-motion-key]")?.getAttribute("data-motion-key") ?? null,
        properties: Array.isArray(keyframes)
          ? Object.keys(keyframes[0] ?? {}).filter((name) => name !== "offset")
          : Object.keys(keyframes ?? {}),
        pill: this.hasAttribute("data-status"),
      });
      const animation = original.call(this, keyframes, options);
      animation.playbackRate = globalThis.screenMotionRate;
      return animation;
    };
    globalThis.screenMotionCalls = calls;
    globalThis.screenMotionRate = 1;
  });
  onTestFailed(async () => {
    mkdirSync(resultsDir, { recursive: true });
    const name = context.task.name.replace(/[^\p{L}\p{N}_-]+/gu, "-");
    await page.screenshot({ path: join(resultsDir, `${name}.png`), fullPage: true });
  });
  context.onTestFinished(() => browserContext.close());
  return page;
}

async function open(page: Page, path: string, pathname: string): Promise<void> {
  await page.goto(path);
  await waitForRouterIdle(page, pathname);
  await page.waitForLoadState("networkidle");
}

const motionCalls = (page: Page) => page.evaluate(() => globalThis.screenMotionCalls.slice());
const clearCalls = (page: Page) =>
  page.evaluate(() => {
    globalThis.screenMotionCalls.length = 0;
  });
const column = (page: Page, name: string) => page.getByRole("region", { name });
const card = (target: Page | Locator, key: string): Locator => {
  const page = "page" in target ? target.page() : target;
  return target.locator("li[data-run]").filter({ has: page.getByText(key, { exact: true }) });
};
const cardButton = (target: Page | Locator, key: string) =>
  card(target, key).locator('button[aria-haspopup="dialog"]');
const tab = (page: Page, name: string) => page.getByRole("tab").filter({ hasText: name });
const runRow = (page: Page, key: string) =>
  page.getByRole("option").filter({ has: page.getByText(key, { exact: true }) });

async function expectQuiet(page: Page): Promise<void> {
  await page.waitForTimeout(QUIET_MS);
  expect(await motionCalls(page)).toEqual([]);
}

async function callsFor(page: Page, key: string): Promise<MotionCall[]> {
  await expect
    .poll(async () => (await motionCalls(page)).filter((call) => call.key === key).length, {
      timeout: CHANGE_VISIBLE_MS,
    })
    .toBeGreaterThan(0);
  return (await motionCalls(page)).filter((call) => call.key === key);
}

describe("Dashboard 움직임(브라우저, 0153)", () => {
  it("첫 렌더와 To do 보기 바꾸기에서는 움직이지 않는다", async (context) => {
    assign();
    const page = await newPage(context);
    await open(page, dashboardPath, "/");
    await expectQuiet(page);

    await tab(page, home.view.todo).click();
    await expect.poll(() => tab(page, home.view.todo).getAttribute("aria-selected")).toBe("true");
    await expectQuiet(page);
  });

  it("SSE 로 칸을 옮긴 카드만 움직이고 다른 칸의 카드는 그대로다", async (context) => {
    const moved = assign();
    const bystander = assign();
    start(bystander.id);
    const page = await newPage(context);
    await open(page, dashboardPath, "/");
    const running = column(page, home.column.running);
    await card(running, bystander.key).waitFor();
    await clearCalls(page);

    start(moved.id);

    await card(running, moved.key).waitFor({ timeout: CHANGE_VISIBLE_MS });
    const calls = await callsFor(page, moved.id);
    expect(calls.some((call) => call.properties.includes("transform"))).toBe(true);
    expect((await motionCalls(page)).some((call) => call.key === bystander.id && call.pill)).toBe(
      false,
    );
  });

  it("카드의 To do 표시가 바뀌면 상태 알약만 한 번 커진다", async (context) => {
    const run = assign();
    start(run.id);
    pause(run.id);
    const page = await newPage(context);
    await open(page, dashboardPath, "/");
    await card(page, run.key).waitFor();
    await clearCalls(page);

    const changed = changeRunState(db, run.id, { to: "disconnected" });
    if (!changed.ok) throw new Error("disconnect failed");

    await card(page, run.key)
      .locator('[data-status="disconnected"]')
      .waitFor({ timeout: CHANGE_VISIBLE_MS });
    const calls = await callsFor(page, run.id);
    expect(calls.some((call) => call.pill && call.properties.includes("transform"))).toBe(true);
  });

  it("알약이 없던 카드에 알약이 새로 생기면 한 번 커진다", async (context) => {
    const run = assign();
    start(run.id);
    const page = await newPage(context);
    await open(page, dashboardPath, "/");
    await card(page, run.key).waitFor();
    expect(await card(page, run.key).locator("[data-status]").count()).toBe(0);
    await clearCalls(page);

    pause(run.id);

    await card(page, run.key).locator("[data-status]").waitFor({ timeout: CHANGE_VISIBLE_MS });
    const calls = await callsFor(page, run.id);
    expect(calls.some((call) => call.pill && call.properties.includes("transform"))).toBe(true);
  });

  it("묶음의 마지막 카드는 접히는 동안 보이고 끝나면 묶음이 숨는다", async (context) => {
    const run = assign();
    start(run.id);
    pause(run.id);
    recordRunQuestions(db, run.id, [
      {
        id: toQuestionId(`check-${run.id}`),
        kind: "human-check",
        body: "Check the preview.",
        options: [],
        askedAt: new Date(),
      },
    ]);
    const page = await newPage(context);
    await open(page, dashboardPath, "/");
    await tab(page, home.view.todo).click();
    await expect.poll(() => tab(page, home.view.todo).getAttribute("aria-selected")).toBe("true");
    const group = page.locator('[data-todo-group="check"]');
    await card(group, run.key).waitFor();
    await page.evaluate(() => {
      globalThis.screenMotionRate = 0.05;
    });

    answerRunQuestion(db, {
      runId: run.id,
      questionId: toQuestionId(`check-${run.id}`),
      answer: "ok",
      kind: "human-check",
    });
    const resumed = changeRunState(db, run.id, { to: "running" });
    if (!resumed.ok) throw new Error("resume failed");

    await expect
      .poll(
        () =>
          page.evaluate((key) => {
            const row = document.querySelector(`li[data-motion-key="${key}"][inert]`);
            return row !== null && row.getBoundingClientRect().height > 0;
          }, run.id),
        { timeout: CHANGE_VISIBLE_MS },
      )
      .toBe(true);
    await page.evaluate(() => {
      globalThis.screenMotionRate = 1;
      for (const animation of document.getAnimations()) animation.finish();
    });
    await expect.poll(() => group.count(), { timeout: CHANGE_VISIBLE_MS }).toBe(0);
  });

  it("움직임 줄이기에서는 칸을 옮겨도 흐려지기만 한다", async (context) => {
    const moved = assign();
    const page = await newPage(context, "reduce");
    await open(page, dashboardPath, "/");
    await card(column(page, home.column.queued), moved.key).waitFor();
    await clearCalls(page);

    start(moved.id);

    await card(column(page, home.column.running), moved.key).waitFor({
      timeout: CHANGE_VISIBLE_MS,
    });
    const calls = await callsFor(page, moved.id);
    expect(calls.every((call) => call.properties.join() === "opacity")).toBe(true);
  });

  it("Sheet 가 닫히는 도중 다른 카드를 누르면 그 카드의 Sheet 가 바로 열린다", async (context) => {
    const first = assign();
    const second = assign();
    const page = await newPage(context);
    await open(page, dashboardPath, "/");
    const queued = column(page, home.column.queued);
    await cardButton(queued, first.key).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByText(first.key, { exact: true }).waitFor();
    await expect
      .poll(() => sheet.evaluate((node) => getComputedStyle(node).transform))
      .toBe("none");
    expect(
      await cardButton(queued, second.key).evaluate((node) => node.closest("[inert]") !== null),
    ).toBe(true);
    const target = await cardButton(queued, second.key).boundingBox();
    if (target === null) throw new Error("no card box");

    const closing = await sheet.evaluate(async (node, closeName) => {
      const close = [...node.querySelectorAll("button")].find(
        (button) => button.textContent === closeName,
      );
      close?.click();
      for (let frame = 0; frame < 60 && !node.hasAttribute("data-ending-style"); frame += 1) {
        await new Promise(requestAnimationFrame);
      }
      for (const animation of document.getAnimations()) animation.playbackRate = 0.02;
      return node.hasAttribute("data-ending-style");
    }, home.sheet.close);
    expect(closing).toBe(true);

    await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2);

    await sheet.getByText(second.key, { exact: true }).waitFor();
    await expect
      .poll(() => sheet.evaluate((node) => node.hasAttribute("data-ending-style")))
      .toBe(false);
  });
});

describe("Runs 움직임(브라우저, 0153)", () => {
  it("첫 렌더와 필터 바꾸기에서는 움직이지 않는다", async (context) => {
    assign();
    const page = await newPage(context);
    await open(page, runsPath, "/runs");
    await expectQuiet(page);

    await tab(page, runs.filter["in-progress"]).click();
    await expect
      .poll(() => tab(page, runs.filter["in-progress"]).getAttribute("aria-selected"))
      .toBe("true");
    await expectQuiet(page);
  });

  it("SSE 로 생긴 행은 들어오고 상태가 바뀐 행의 알약은 한 번 커진다", async (context) => {
    const existing = assign();
    const page = await newPage(context);
    await open(page, runsPath, "/runs");
    await runRow(page, existing.key).waitFor();
    await clearCalls(page);

    const fresh = assign();
    await runRow(page, fresh.key).waitFor({ timeout: CHANGE_VISIBLE_MS });
    const entered = await callsFor(page, fresh.id);
    expect(entered.some((call) => call.properties.includes("gridTemplateRows"))).toBe(true);

    await clearCalls(page);
    start(existing.id);
    await runRow(page, existing.key)
      .locator('[data-status="running"]')
      .waitFor({ timeout: CHANGE_VISIBLE_MS });
    const changed = await callsFor(page, existing.id);
    expect(changed.some((call) => call.pill)).toBe(true);
  });

  it("비어 있던 필터 목록에 처음 생긴 행도 들어온다", async (context) => {
    const run = assign();
    start(run.id);
    const page = await newPage(context);
    await open(page, `${runsPath}&f=canceled`, "/runs");
    await page.getByText(runs.empty, { exact: true }).waitFor();
    await clearCalls(page);

    const ended = changeRunState(db, run.id, {
      to: "ended",
      agentResult: "canceled",
      prState: "none",
    });
    if (!ended.ok) throw new Error(`end failed: ${JSON.stringify(ended.error)}`);

    await runRow(page, run.key).waitFor({ timeout: CHANGE_VISIBLE_MS });
    const calls = await callsFor(page, run.id);
    expect(calls.some((call) => call.properties.includes("gridTemplateRows"))).toBe(true);
  });

  it("움직임 줄이기에서는 새 행이 흐려지며 들어온다", async (context) => {
    const page = await newPage(context, "reduce");
    await open(page, runsPath, "/runs");
    await clearCalls(page);

    const fresh = assign();

    await runRow(page, fresh.key).waitFor({ timeout: CHANGE_VISIBLE_MS });
    const calls = await callsFor(page, fresh.id);
    expect(calls.every((call) => call.properties.join() === "opacity")).toBe(true);
  });
});

describe("Run 상세 타임라인 움직임(브라우저, 0153)", () => {
  const timelineCalls = async (page: Page) =>
    (await motionCalls(page)).filter((call) => call.key?.startsWith("waiting-for-input:"));

  it("첫 렌더는 움직이지 않고 SSE 로 붙은 새 줄만 떠오른다", async (context) => {
    const run = assign();
    start(run.id);
    const page = await newPage(context);
    await open(page, `/runs/${run.id}?ws=${workspaceId}`, `/runs/${run.id}`);
    await expectQuiet(page);

    pause(run.id);

    await expect
      .poll(async () => (await timelineCalls(page)).length, { timeout: CHANGE_VISIBLE_MS })
      .toBeGreaterThan(0);
    const calls = await motionCalls(page);
    expect(calls.every((call) => call.key?.startsWith("waiting-for-input:"))).toBe(true);
    expect((await timelineCalls(page))[0]?.properties).toEqual(["opacity", "transform"]);
  });

  it("움직임 줄이기에서는 새 줄이 흐려지기만 한다", async (context) => {
    const run = assign();
    start(run.id);
    const page = await newPage(context, "reduce");
    await open(page, `/runs/${run.id}?ws=${workspaceId}`, `/runs/${run.id}`);
    await clearCalls(page);

    pause(run.id);

    await expect
      .poll(async () => (await timelineCalls(page)).length, { timeout: CHANGE_VISIBLE_MS })
      .toBeGreaterThan(0);
    const calls = await timelineCalls(page);
    expect(calls.every((call) => call.properties.join() === "opacity")).toBe(true);
  });
});
