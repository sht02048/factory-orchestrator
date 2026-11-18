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
  toPermissionRequestId,
  toQuestionId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTicketKey,
  toTrackerStateId,
  toWorktreeRef,
} from "@factory/core";
import type { RunId, TicketKey } from "@factory/core";
import {
  SecretBox,
  assignRun,
  changeRunState,
  listRunQuestions,
  migrate,
  openDatabase,
  recordPermissionWaits,
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
} from "@factory/db";
import type { Database } from "@factory/db";
import { chromium } from "playwright-core";
import type { Browser, BrowserContext, Locator, Page } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed } from "vitest";
import home from "../../apps/web/messages/ko/home.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const runnerKind = toRunnerKind("fake");
const runnerId = toRunnerId("runner-a");
const runnerProject = toRunnerProjectId("fake:acme/web");
const agent = toAgentId("claude");
const encryptionKey = new Uint8Array(32).fill(7);

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let context: BrowserContext;
let page: Page;
const runIds = new Map<string, RunId>();

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
  dir = mkdtempSync(join(tmpdir(), "factory-home-"));
  const dbPath = join(dir, "factory.db");
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
  await openHome(warm);
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

beforeEach(async (test) => {
  context = await browser.newContext({ baseURL: baseUrl, locale: "ko-KR" });
  page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const current = page;
  onTestFailed(async () => {
    mkdirSync(resultsDir, { recursive: true });
    const name = test.task.name.replace(/[^\p{L}\p{N}_-]+/gu, "-");
    await current.screenshot({ path: join(resultsDir, `${name}.png`), fullPage: true });
  });
});

const longChoice =
  "Keep the cache in SQLite so that it survives restarts, and add a nightly job that removes entries older than thirty days from every table";

describe("Dashboard 질문 레이어(브라우저, 0060)", () => {
  it("답하기를 누르면 첫 선택지에 포커스가 가고, ×·Escape·바깥 누르기로 닫으면 답하기로 돌아온다", async () => {
    await openHome(page);
    const trigger = todoRow(page, "ACME-1").getByRole("button", { name: home.row.answer });
    const layer = page.getByRole("dialog");

    await trigger.click();
    expect(await focusedSoon(layer.getByRole("radio", { name: "SQLite" }))).toBe(true);
    await layer.getByRole("button", { name: home.question.close }).click();
    await layer.waitFor({ state: "hidden" });
    expect(await focusedSoon(trigger)).toBe(true);

    await page.keyboard.press("Enter");
    await layer.waitFor();
    await page.keyboard.press("Escape");
    await layer.waitFor({ state: "hidden" });
    expect(await focusedSoon(trigger)).toBe(true);

    await trigger.click();
    await layer.waitFor();
    await page.getByRole("heading", { level: 1, name: home.title }).click();
    await layer.waitFor({ state: "hidden" });
    expect(await focusedSoon(trigger)).toBe(true);
  });

  it("선택지를 골라도 보내지 않고, 보내기를 눌러야 보낸 뒤 레이어를 닫고 결과를 status 로 알린다", async () => {
    await openHome(page);
    const row = todoRow(page, "ACME-4");
    await row.getByRole("button", { name: home.row.answer }).click();
    const layer = page.getByRole("dialog");
    const send = layer.getByRole("button", { name: home.question.send });
    expect(await send.isDisabled()).toBe(true);

    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") posts.push(request.url());
    });
    await layer.getByRole("radio", { name: "No" }).check();
    await layer.getByRole("radio", { name: "Yes" }).check();
    await page.waitForTimeout(500);
    expect(posts).toEqual([]);
    expect(unansweredQuestions("ACME-4")).toEqual(["q-4"]);
    expect(await send.isEnabled()).toBe(true);

    await send.click();
    const status = row.getByRole("status");
    await status.getByText(home.question.answered).waitFor();
    await layer.waitFor({ state: "hidden" });
    expect(await focusedSoon(status)).toBe(true);
    expect(answerOf("ACME-4")).toBe("Yes");
  });

  it("직접 쓰기를 고르면 글쓰기 칸이 열리고 ⌘ Enter 로 보낸다", async () => {
    await openHome(page);
    const row = todoRow(page, "ACME-6");
    await row.getByRole("button", { name: home.row.answer }).click();
    const layer = page.getByRole("dialog");
    expect(await layer.getByLabel(home.question.otherLabel).count()).toBe(0);
    await layer.getByRole("radio", { name: home.question.other }).check();
    const other = layer.getByLabel(home.question.otherLabel);
    expect(await focusedSoon(other)).toBe(true);
    await other.fill("Ship it on Friday.");
    await page.keyboard.press("ControlOrMeta+Enter");
    await row.getByRole("status").getByText(home.question.answered).waitFor();
    expect(answerOf("ACME-6")).toBe("Ship it on Friday.");
  });

  it("긴 선택지 문구는 레이어 안에서 줄을 바꿔 다 보인다", async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openHome(page);
    await todoRow(page, "ACME-3").getByRole("button", { name: home.row.answer }).click();
    const layer = page.getByRole("dialog");
    const text = layer.getByText(longChoice, { exact: true });
    const box = await text.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight);
      const dialog = el.closest('[role="dialog"]')?.getBoundingClientRect();
      return {
        clipped: el.scrollWidth > el.clientWidth,
        lines: Math.round(rect.height / lineHeight),
        inside: dialog !== undefined && rect.left >= dialog.left && rect.right <= dialog.right,
        viewport: rect.right <= window.innerWidth,
      };
    });
    expect(box).toMatchObject({ clipped: false, inside: true, viewport: true });
    expect(box.lines).toBeGreaterThan(1);
  });

  it("레이어가 열린 화면에서 파란 주 버튼은 레이어 안의 보내기 하나뿐이다(ADR 0010 6번)", async () => {
    await openHome(page);
    await todoRow(page, "ACME-1").getByRole("button", { name: home.row.answer }).click();
    await page.getByRole("dialog").waitFor();
    const primary = await page
      .locator('[data-variant="primary"]')
      .evaluateAll((els) =>
        els.filter((el) => el.getClientRects().length > 0).map((el) => el.textContent),
      );
    expect(primary).toEqual([home.question.send]);
  });

  it("거절하기는 이유 칸에 포커스를 주고, Escape 로 닫으면 거절하기로, 보내면 결과 status 로 포커스가 간다", async () => {
    await openHome(page);
    const trigger = todoRow(page, "ACME-2").getByRole("button", { name: home.row.deny });
    await trigger.click();
    const layer = page.getByRole("dialog");
    expect(await focusedSoon(layer.getByLabel(home.permission.reasonLabel))).toBe(true);
    await page.keyboard.press("Escape");
    await layer.waitFor({ state: "hidden" });
    expect(await focusedSoon(trigger)).toBe(true);

    const row = todoRow(page, "ACME-5");
    await row.getByRole("button", { name: home.row.deny }).click();
    await layer.getByRole("button", { name: home.permission.send }).click();
    const status = row.getByRole("status");
    await status.getByText(home.permission.denied).waitFor();
    expect(await focusedSoon(status)).toBe(true);
  });
});

describe("Dashboard 배치(브라우저, 0060)", () => {
  it("러너 문제는 To do 에 없고 Runners 카드에 이름 링크로 보인다", async () => {
    await openHome(page);
    const todo = page.getByRole("region", { name: home.section.todo });
    const runners = page.getByRole("region", { name: home.section.runners });
    expect(await todo.getByText("runner-b").count()).toBe(0);
    expect(await runners.getByRole("link", { name: "runner-b" }).getAttribute("href")).toBe(
      "/runners?sel=runner-b",
    );
    await runners.getByText(home.runners.offline, { exact: true }).waitFor();
  });

  it("375px 폭에서 행과 페이지가 넘치지 않는다", async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openHome(page);
    const overflow = await page.evaluate(() => ({
      rows: [...document.querySelectorAll("li")]
        .filter((li) => li.scrollWidth > li.clientWidth + 1)
        .map((li) => li.textContent),
      outside: [...document.querySelectorAll("li")]
        .filter((li) => li.getBoundingClientRect().right > window.innerWidth)
        .map((li) => li.textContent),
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(overflow).toEqual({ rows: [], outside: [], page: 0 });
  });

  it("행 제목은 그 런의 Run 상세로 가는 링크이고 행 전체는 링크가 아니다", async () => {
    await openHome(page);
    const todo = page.getByRole("region", { name: home.section.todo });
    const link = todo.getByRole("link", { name: "ACME-2", exact: true });
    expect(await link.getAttribute("href")).toBe(`/runs/${runIds.get("ACME-2")}?ws=${workspaceId}`);
    expect(await todo.locator("li > a").count()).toBe(0);
  });

  it("글쓰기 칸 글자 크기는 폭이 아니라 포인터로 바뀐다(정밀 14px, 터치 16px)", async () => {
    const fontSizeAt = async (target: Page, width: number) => {
      await target.setViewportSize({ width, height: 900 });
      await openHome(target);
      await todoRow(target, "ACME-3").getByRole("button", { name: home.row.answer }).click();
      const layer = target.getByRole("dialog");
      await layer.getByRole("radio", { name: home.question.other }).check();
      const size = await layer
        .getByLabel(home.question.otherLabel)
        .evaluate((input) => getComputedStyle(input).fontSize);
      await target.keyboard.press("Escape");
      return size;
    };
    expect(await page.evaluate(() => matchMedia("(pointer: fine)").matches)).toBe(true);
    expect(await fontSizeAt(page, 1280)).toBe("14px");
    expect(await fontSizeAt(page, 375)).toBe("14px");

    const touch = await browser.newContext({ baseURL: baseUrl, locale: "ko-KR", hasTouch: true });
    try {
      const tablet = await touch.newPage();
      tablet.setDefaultTimeout(30_000);
      await tablet.goto("/");
      expect(await tablet.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
      expect(await fontSizeAt(tablet, 1180)).toBe("16px");
    } finally {
      await touch.close();
    }
  });

  it("버튼은 보이는 높이 32px 그대로, 터치에서만 누르는 영역을 44×44px 로 넓힌다", async () => {
    const hitArea = async (target: Page) => {
      await openHome(target);
      const button = todoRow(target, "ACME-3").getByRole("button", { name: home.row.answer });
      return button.evaluate((el) => {
        const before = getComputedStyle(el, "::before");
        return {
          height: el.getBoundingClientRect().height,
          content: before.content,
          before: [before.width, before.height],
        };
      });
    };
    const mouse = await hitArea(page);
    expect(mouse.height).toBe(32);
    expect(mouse.content).toBe("none");

    const touch = await browser.newContext({ baseURL: baseUrl, locale: "ko-KR", hasTouch: true });
    try {
      const tablet = await touch.newPage();
      tablet.setDefaultTimeout(30_000);
      const coarse = await hitArea(tablet);
      expect(coarse.height).toBe(32);
      expect(coarse.content).not.toBe("none");
      const [width, height] = coarse.before.map((v) => Number.parseFloat(v ?? "0"));
      expect(width).toBeGreaterThanOrEqual(44);
      expect(height).toBe(44);
    } finally {
      await touch.close();
    }
  });

  it("새로 고치지 않아도 새 To do 가 보인다", async () => {
    await openHome(page);
    const row = todoRow(page, "ACME-9");
    expect(await row.count()).toBe(0);
    const run = startRun(toTicketKey("ACME-9"));
    ok(changeRunState(db, run, { to: "waiting-for-input" }));
    recordRunQuestions(db, run, [
      { id: toQuestionId("q-9"), body: "Ship it?", options: [], askedAt: new Date() },
    ]);
    await row.getByText("Ship it?").waitFor({ timeout: 25_000 });
  });

  it("다시 읽기가 실패해도 지금 화면과 열린 레이어, 쓰던 답을 그대로 둔다", async () => {
    await openHome(page);
    await todoRow(page, "ACME-3").getByRole("button", { name: home.row.answer }).click();
    const layer = page.getByRole("dialog");
    await layer.getByRole("radio", { name: home.question.other }).check();
    const input = layer.getByLabel(home.question.otherLabel);
    await input.fill("half-written answer");

    let failed = 0;
    await page.route("**/_serverFn/**", async (route) => {
      failed += 1;
      await route.abort();
    });
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForTimeout(1_000);
    await page.unroute("**/_serverFn/**");

    expect(failed).toBeGreaterThan(0);
    expect(await input.inputValue()).toBe("half-written answer");
    expect(await page.getByRole("heading", { level: 1, name: home.title }).count()).toBe(1);
  });
});

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

  const projects = [{ id: runnerProject, displayName: "acme/web", setupState: "ready" as const }];
  saveRunner(db, { id: runnerId, kind: runnerKind, name: "runner-a", config: {}, capacity: 8 });
  recordRunnerCheck(db, {
    runnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects,
    assignmentBlocked: false,
  });

  saveRunner(db, {
    id: toRunnerId("runner-b"),
    kind: runnerKind,
    name: "runner-b",
    config: {},
    capacity: 1,
  });
  recordRunnerCheck(db, {
    runnerId: toRunnerId("runner-b"),
    online: false,
    checkedAt: new Date(),
    error: null,
    projects: null,
    assignmentBlocked: false,
  });

  const question = (key: string, id: string, body: string, options: string[]) => {
    const run = startRun(toTicketKey(key));
    ok(changeRunState(db, run, { to: "waiting-for-input" }));
    recordRunQuestions(db, run, [{ id: toQuestionId(id), body, options, askedAt: new Date() }]);
  };
  question("ACME-1", "q-1", "Which database should the cache use?", ["SQLite", "In memory"]);
  question("ACME-3", "q-3", "Rename the module?", [longChoice, "Keep the name"]);
  question("ACME-4", "q-4", "Add a retry?", ["Yes", "No"]);
  question("ACME-6", "q-6", "When should it ship?", []);

  const denyRun = startRun(toTicketKey("ACME-5"));
  ok(changeRunState(db, denyRun, { to: "waiting-for-input" }));
  recordPermissionWaits(db, denyRun, [
    { id: toPermissionRequestId("p-5"), detail: "rm -rf build", requestedAt: new Date() },
  ]);

  const permissionRun = startRun(toTicketKey("ACME-2"));
  ok(changeRunState(db, permissionRun, { to: "waiting-for-input" }));
  recordPermissionWaits(db, permissionRun, [
    { id: toPermissionRequestId("p-1"), detail: "git push --force", requestedAt: new Date() },
  ]);
}

function startRun(key: TicketKey): RunId {
  const assigned = assignRun(db, {
    ticket: { connection, key },
    trackerProject,
    runnerProject,
    agent,
    runnerId,
  });
  if (!assigned.ok) throw new Error(`assign ${key} failed: ${assigned.reason}`);
  const worktree = `wt-${key}`;
  ok(
    changeRunState(db, assigned.run.id, {
      to: "running",
      started: {
        worktree: toWorktreeRef(worktree),
        branch: `acme/${worktree}`,
        agentRef: toAgentRef(`agent-${worktree}`),
      },
    }),
  );
  runIds.set(key, assigned.run.id);
  return assigned.run.id;
}

function ok(result: { ok: true } | { ok: false; error: unknown }): void {
  if (!result.ok) throw new Error(`state change failed: ${JSON.stringify(result.error)}`);
}

function todoRow(target: Page, key: string): Locator {
  return target
    .getByRole("region", { name: home.section.todo })
    .getByRole("listitem")
    .filter({ has: target.getByRole("link", { name: key, exact: true }) });
}

function questionsOf(key: string) {
  const run = runIds.get(key);
  if (run === undefined) throw new Error(`no run for ${key}`);
  return listRunQuestions(db, run);
}

function unansweredQuestions(key: string): string[] {
  return questionsOf(key)
    .filter((q) => q.answer === null)
    .map((q) => q.id);
}

function answerOf(key: string): string | undefined {
  return questionsOf(key).find((q) => q.answer !== null)?.answer?.text;
}

async function openHome(target: Page): Promise<void> {
  await target.goto(`/?ws=${workspaceId}`);
  await hydrated(target);
}

async function focusedSoon(locator: Locator): Promise<boolean> {
  return locator.evaluate(
    (el) =>
      new Promise<boolean>((resolve) => {
        const started = Date.now();
        const check = () => {
          if (document.activeElement === el) resolve(true);
          else if (Date.now() - started > 5_000) resolve(false);
          else requestAnimationFrame(check);
        };
        check();
      }),
  );
}

async function hydrated(target: Page): Promise<void> {
  await target.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await target.waitForLoadState("networkidle");
}
