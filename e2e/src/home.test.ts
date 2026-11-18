// 브라우저 안에서 도는 evaluate 함수가 DOM 전역(document, getComputedStyle)을 쓴다
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
import { createServer } from "vite";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed } from "vitest";
import domain from "../../apps/web/messages/ko/domain.json" with { type: "json" };
import home from "../../apps/web/messages/ko/home.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";

/*
 * Home 을 키보드·화면 읽기·터치로 써도 깨지지 않는지 실제 브라우저로 보는 시험(티켓 0050).
 *
 * - "직접 답하기"·"거절" 폼을 열면 입력칸에 포커스가 가고, 취소·Escape 로 닫으면 트리거 버튼으로 돌아온다
 * - 답·거절이 성공하면 결과 문장이 role="status" 이고 포커스를 받는다
 * - 입력칸 글자 크기는 화면 폭이 아니라 포인터 종류로 바뀐다
 * - 지금 일어나는 일의 행은 Run 상세 링크다
 * - 새로 고치지 않아도 새 손댈 일이 보인다(문서가 보일 때 15초마다 다시 읽는다)
 * - 375px 폭에서 머리 영역이 넘치지 않는다
 *
 * 띄우는 방식은 operator-actions 시험(티켓 0039)과 같다. 공용 도우미를 고치지 않으려고 필요한 것은 이 파일에 둔다.
 * 시험이 실패하면 그때의 화면을 e2e/test-results 에 남긴다(CI 산출물).
 */

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

/** web 의 server/adapters.ts 를 가짜 트래커 등록표로 바꾼다. 제품 코드는 고치지 않는다 */
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
}, 120_000);

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

describe("Home 접근성(브라우저, 0050)", () => {
  it("키보드로 '직접 답하기'를 열면 입력칸에, Escape·취소로 닫으면 트리거 버튼에 포커스가 간다", async () => {
    await openHome(page);
    const card = questionCard(page, "ACME-1");
    const trigger = card.getByRole("button", { name: home.question.write });

    await trigger.focus();
    await page.keyboard.press("Enter");
    expect(await focusedSoon(card.getByLabel(home.question.answerLabel))).toBe(true);
    await page.keyboard.press("Escape");
    expect(await focusedSoon(trigger)).toBe(true);

    await page.keyboard.press("Enter");
    expect(await focusedSoon(card.getByLabel(home.question.answerLabel))).toBe(true);
    await card.getByRole("button", { name: home.question.cancel }).focus();
    await page.keyboard.press("Enter");
    expect(await focusedSoon(trigger)).toBe(true);
  });

  it("키보드로 '거절'을 열면 이유 칸에, Escape·취소로 닫으면 거절 버튼에 포커스가 간다", async () => {
    await openHome(page);
    const card = permissionCard(page, "ACME-2");
    const trigger = card.getByRole("button", { name: home.permission.deny, exact: true });

    await trigger.focus();
    await page.keyboard.press("Enter");
    expect(await focusedSoon(card.getByLabel(home.permission.reasonLabel))).toBe(true);
    await page.keyboard.press("Escape");
    expect(await focusedSoon(trigger)).toBe(true);

    await page.keyboard.press("Enter");
    expect(await focusedSoon(card.getByLabel(home.permission.reasonLabel))).toBe(true);
    await card.getByRole("button", { name: home.permission.cancel }).focus();
    await page.keyboard.press("Enter");
    expect(await focusedSoon(trigger)).toBe(true);
  });

  it("답을 남기면 결과 문장이 status 로 보이고 포커스를 받는다", async () => {
    await openHome(page);
    const card = questionCard(page, "ACME-4");
    await card.getByRole("button", { name: home.question.write }).click();
    await card.getByLabel(home.question.answerLabel).fill("Use SQLite.");
    await page.keyboard.press("Enter");
    const status = card.getByRole("status");
    await status.getByText(home.question.answered).waitFor();
    expect(await focusedSoon(status)).toBe(true);
  });

  it("거절을 남기면 결과 문장이 status 로 보이고 포커스를 받는다", async () => {
    await openHome(page);
    const card = permissionCard(page, "ACME-5");
    await card.getByRole("button", { name: home.permission.deny, exact: true }).click();
    await card.getByRole("button", { name: home.permission.send }).click();
    const status = card.getByRole("status");
    await status.getByText(home.permission.denied).waitFor();
    expect(await focusedSoon(status)).toBe(true);
  });

  it("입력칸 글자 크기는 폭이 아니라 포인터로 바뀐다(정밀 14px, 터치 16px)", async () => {
    const fontSizeAt = async (target: Page, width: number) => {
      await target.setViewportSize({ width, height: 900 });
      await openHome(target);
      const card = questionCard(target, "ACME-3");
      await card.getByRole("button", { name: home.question.write }).click();
      return card
        .getByLabel(home.question.answerLabel)
        .evaluate((input) => getComputedStyle(input).fontSize);
    };
    // 마우스(정밀 포인터): 좁은 폭에서도 14px
    expect(await page.evaluate(() => matchMedia("(pointer: fine)").matches)).toBe(true);
    expect(await fontSizeAt(page, 1280)).toBe("14px");
    expect(await fontSizeAt(page, 375)).toBe("14px");

    // 터치(거친 포인터): 넓은 폭(iPad 가로)에서도 16px 이라 포커스 때 확대하지 않는다
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
      const button = questionCard(target, "ACME-3").getByRole("button", {
        name: home.question.write,
      });
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

  it("지금 일어나는 일의 행은 그 런의 Run 상세로 가는 링크다", async () => {
    await openHome(page);
    const feed = page.getByRole("complementary", { name: home.activity.title });
    const links = await feed
      .getByRole("link")
      .evaluateAll((els) =>
        els.map((el) => ({ text: el.textContent ?? "", href: el.getAttribute("href") })),
      );
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const key = /ACME-\d+/.exec(link.text)?.[0];
      expect(key).toBeDefined();
      expect(link.href).toBe(`/runs/${runIds.get(key ?? "")}?ws=${workspaceId}`);
    }
  });

  it("새로 고치지 않아도 새 손댈 일이 보인다", async () => {
    await openHome(page);
    const card = questionCard(page, "ACME-9");
    expect(await card.count()).toBe(0);
    // 화면을 연 뒤 worker 가 새 질문을 쓴다
    const run = startRun(toTicketKey("ACME-9"));
    ok(changeRunState(db, run, { to: "waiting-for-input" }));
    recordRunQuestions(db, run, [
      { id: toQuestionId("q-9"), body: "Ship it?", options: [], askedAt: new Date() },
    ]);
    // 15초 주기로 다시 읽는다
    await card.getByText("Ship it?").waitFor({ timeout: 25_000 });
  });

  it("다시 읽기가 실패해도 지금 화면과 열린 폼, 쓰던 답을 그대로 둔다", async () => {
    await openHome(page);
    const card = questionCard(page, "ACME-3");
    await card.getByRole("button", { name: home.question.write }).click();
    const input = card.getByLabel(home.question.answerLabel);
    await input.fill("half-written answer");

    // 서버 함수 요청을 모두 실패시키고, 문서가 다시 보인 것처럼 곧바로 다시 읽게 한다
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

  it("375px 폭에서 머리 영역이 넘치지 않는다", async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openHome(page);
    const header = page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) });
    const overflow = await header.evaluate((el) => ({
      header: el.scrollWidth - el.clientWidth,
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      right: Math.max(...[...el.querySelectorAll("*")].map((c) => c.getBoundingClientRect().right)),
    }));
    expect(overflow.header).toBe(0);
    expect(overflow.page).toBe(0);
    expect(overflow.right).toBeLessThanOrEqual(375);
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

  // 질문을 기다리는 런 둘: 포커스 시험(ACME-1), 글자 크기 시험(ACME-3)
  const questionRun = startRun(toTicketKey("ACME-1"));
  ok(changeRunState(db, questionRun, { to: "waiting-for-input" }));
  recordRunQuestions(db, questionRun, [
    {
      id: toQuestionId("q-1"),
      body: "Which database should the cache use?",
      options: [],
      askedAt: new Date(),
    },
  ]);
  const fontRun = startRun(toTicketKey("ACME-3"));
  ok(changeRunState(db, fontRun, { to: "waiting-for-input" }));
  recordRunQuestions(db, fontRun, [
    { id: toQuestionId("q-3"), body: "Rename the module?", options: [], askedAt: new Date() },
  ]);

  // 시험마다 다른 런을 쓴다. 답·거절을 남기는 시험이 포커스 시험의 런을 바꾸지 않게 한다
  const answerRun = startRun(toTicketKey("ACME-4"));
  ok(changeRunState(db, answerRun, { to: "waiting-for-input" }));
  recordRunQuestions(db, answerRun, [
    { id: toQuestionId("q-4"), body: "Add a retry?", options: [], askedAt: new Date() },
  ]);
  const denyRun = startRun(toTicketKey("ACME-5"));
  ok(changeRunState(db, denyRun, { to: "waiting-for-input" }));
  recordPermissionWaits(db, denyRun, [
    { id: toPermissionRequestId("p-5"), detail: "rm -rf build", requestedAt: new Date() },
  ]);

  // 권한 허용을 기다리는 런: 거절 포커스 시험
  const permissionRun = startRun(toTicketKey("ACME-2"));
  ok(changeRunState(db, permissionRun, { to: "waiting-for-input" }));
  recordPermissionWaits(db, permissionRun, [
    { id: toPermissionRequestId("p-1"), detail: "git push --force", requestedAt: new Date() },
  ]);
}

/** 런을 할당하고 러너에서 시작한 상태로 둔다(worker 가 하는 일을 DB 에 직접 쓴다) */
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

/** 손댈 일 카드(section aria-label="{종류} {이름}") */
function attentionCard(target: Page, kind: string, key: string): Locator {
  return target.getByRole("region", {
    name: home.card.label.replace("{kind}", kind).replace("{name}", key),
  });
}

function questionCard(target: Page, key: string): Locator {
  return attentionCard(target, domain.attention.question, key);
}

function permissionCard(target: Page, key: string): Locator {
  return attentionCard(target, domain.attention.permission, key);
}

async function openHome(target: Page): Promise<void> {
  await target.goto(`/?ws=${workspaceId}`);
  await hydrated(target);
}

/** 이 요소가 5초 안에 포커스를 갖는지. 포커스는 다시 그린 뒤(effect)에 옮겨지므로 잠시 기다린다 */
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

/**
 * 서버 렌더한 화면에 React 가 붙을 때까지 기다린다. 붙기 전에 누르면 클릭이 사라진다.
 * TanStack Router 는 하이드레이션이 끝나면 window.__TSR_ROUTER__ 를 둔다.
 */
async function hydrated(target: Page): Promise<void> {
  await target.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await target.waitForLoadState("networkidle");
}
