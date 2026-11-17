import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  toAgentId,
  toAgentRef,
  toCodeHostKind,
  toQuestionId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTicketKey,
  toWorktreeRef,
} from "@factory/core";
import type { RunId, TicketKey } from "@factory/core";
import {
  SecretBox,
  assignRun,
  changeRunState,
  listPendingCancelRequests,
  listRunQuestions,
  listRuns,
  migrate,
  openDatabase,
  recordRunQuestions,
  recordRunnerCheck,
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
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed } from "vitest";
import domain from "../../apps/web/messages/ko/domain.json" with { type: "json" };
import home from "../../apps/web/messages/ko/home.json" with { type: "json" };
import run from "../../apps/web/messages/ko/run.json" with { type: "json" };
import runs from "../../apps/web/messages/ko/runs.json" with { type: "json" };
import tickets from "../../apps/web/messages/ko/tickets.json" with { type: "json" };
import {
  connection,
  fakeKind,
  trackerProject,
  unassignedTicket,
  workspaceId,
} from "./browser/fixtures.js";

/*
 * 운영자의 핵심 동작을 실제 브라우저로 누르는 시험(티켓 0039).
 *
 * - 손댈 일에서 에이전트 질문에 답한다 → DB 에 답 하나, Run 상세 타임라인에 보임
 * - Run 상세에서 런 취소를 요청한다 → "취소 중" 표시와 DB 요청 하나
 * - Tickets 에서 수동 할당한다 → Queued 런 하나, Runs 화면에 보임
 *
 * web 은 0008 얇은 경로 시험처럼 apps/web 의 vite 설정으로 개발 서버를 띄우고, 브라우저는 playwright-core 로
 * 설치된 Chrome 을 띄운다(GitHub ubuntu 러너에 있어 CI 에서 브라우저를 내려받지 않는다).
 * worker 는 띄우지 않는다. web 이 DB 에 남긴 요청을 그대로 읽어 확인한다(Q61).
 * Tickets 가 읽는 트래커는 vite 플러그인으로 server/adapters.ts 를 core 가짜 트래커 등록표로 바꿔 끼운다.
 *
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

const questionId = toQuestionId("q-1");
const questionBody = "Which database should the cache use?";
const answerText = "Use SQLite.";

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let page: Page;
let questionRun: RunId;
let runningRun: RunId;

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
  dir = mkdtempSync(join(tmpdir(), "factory-browser-"));
  const dbPath = join(dir, "factory.db");
  db = openDatabase(dbPath);
  migrate(db);
  seed(db);

  // web 은 부팅 설정(환경 변수)으로 DB 를 연다(packages/db parseBootConfig).
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

beforeEach(async (context) => {
  // 페이지는 시험마다 새로 열고 afterAll 에서 브라우저와 함께 닫는다.
  // onTestFailed 는 afterEach 뒤에 돌아, afterEach 에서 닫으면 실패 화면을 찍지 못한다.
  page = await browser.newPage({ baseURL: baseUrl, locale: "ko-KR" });
  // 개발 서버는 화면 모듈을 처음 요청할 때 변환해 첫 화면이 느리다. 화면을 기다리는 waitFor 도 이 시간을 쓴다.
  page.setDefaultTimeout(30_000);
  const current = page;
  onTestFailed(async () => {
    mkdirSync(resultsDir, { recursive: true });
    const name = context.task.name.replace(/[^\p{L}\p{N}_-]+/gu, "-");
    await current.screenshot({ path: join(resultsDir, `${name}.png`), fullPage: true });
  });
});

describe("운영자 핵심 동작(브라우저)", () => {
  it("answer: 손댈 일에서 에이전트 질문에 답하면 DB 에 답이 하나 남고 화면에 보인다", async () => {
    await page.goto(`/?ws=${workspaceId}`);
    await hydrated(page);
    await page
      .getByRole("listbox", { name: home.section.attention })
      .getByRole("option", { name: "ACME-1" })
      .click();

    const panel = page.getByRole("region", { name: home.panel.label });
    await panel.getByText(questionBody).waitFor();
    await panel.getByLabel(home.question.answerLabel).fill(answerText);
    await panel.getByRole("button", { name: home.question.send }).click();
    await panel.getByText(home.question.answered).waitFor();

    const answered = listRunQuestions(db, questionRun).filter((q) => q.answer !== null);
    expect(answered.map((q) => [q.id, q.answer?.text])).toEqual([[questionId, answerText]]);

    // 남긴 답이 Run 상세 타임라인에 보인다
    await page.goto(`/runs/${questionRun}?ws=${workspaceId}`);
    await hydrated(page);
    await page.getByText(answerText, { exact: true }).waitFor();
  });

  it("cancel: Run 상세에서 런 취소를 요청하면 취소 중이 보이고 DB 에 요청이 하나 남는다", async () => {
    await page.goto(`/runs/${runningRun}?ws=${workspaceId}`);
    await hydrated(page);
    await page.getByRole("button", { name: run.cancel.trigger }).click();
    const dialog = page.getByRole("dialog", { name: run.cancel.title });
    await dialog.getByRole("button", { name: run.cancel.confirm }).click();

    await page.getByText(run.cancelPending, { exact: true }).waitFor();
    expect(await page.getByRole("button", { name: run.cancel.trigger }).count()).toBe(0);
    expect(listPendingCancelRequests(db).map((request) => request.runId)).toEqual([runningRun]);
  });

  it("assign: Tickets 에서 수동 할당하면 Queued 런이 하나 생기고 Runs 화면에 보인다", async () => {
    const key = unassignedTicket.key;
    await page.goto(`/tickets?ws=${workspaceId}`);
    await hydrated(page);
    await page
      .getByRole("listbox", { name: tickets.listLabel })
      .getByRole("option", { name: unassignedTicket.title })
      .click();
    await page.getByRole("button", { name: tickets.panel.assign }).click();
    const dialog = page.getByRole("dialog", { name: fill(tickets.assign.title, { key }) });
    await dialog.getByRole("button", { name: tickets.assign.submit }).click();

    await page.getByText(fill(tickets.assign.done, { key })).waitFor();
    const created = runsOf(key);
    expect(created.map((r) => [r.state, r.runnerProject, r.agent])).toEqual([
      ["queued", runnerProject, agent],
    ]);

    // 새 런이 Runs 화면 목록에 Queued 로 보인다
    await page.goto(`/runs?ws=${workspaceId}`);
    await hydrated(page);
    const row = page
      .getByRole("listbox", { name: runs.listLabel })
      .getByRole("option", { name: key });
    await row.getByText(domain.runState.queued, { exact: true }).waitFor();
  });
});

describe("화면 시각의 시간대(브라우저, 0044)", () => {
  it("브라우저 시간대로 시각을 그리고, 쿠키를 남긴 뒤에는 서버 렌더링부터 그 시간대다", async () => {
    const context = await browser.newContext({
      baseURL: baseUrl,
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
    });
    const seoul = await context.newPage();
    seoul.setDefaultTimeout(30_000);
    const consoleErrors: string[] = [];
    seoul.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    const assignedAt = runsOf(toTicketKey("ACME-1"))[0]?.assignedAt;
    if (assignedAt === undefined) throw new Error("no ACME-1 run");
    const timeIn = (timeZone: string) =>
      new Intl.DateTimeFormat("ko-KR", {
        timeZone,
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(assignedAt);
    const path = `/runs/${questionRun}?ws=${workspaceId}`;

    try {
      // 첫 방문: 쿠키가 없어 서버는 UTC 로 그리고, 브라우저가 시간대를 남긴 뒤 서울 시각으로 다시 그린다.
      const first = await seoul.goto(path);
      expect(await first?.text()).toContain(timeIn("UTC"));
      await hydrated(seoul);
      await seoul.getByText(timeIn("Asia/Seoul")).first().waitFor();
      const cookies = await context.cookies();
      expect(cookies.find((c) => c.name === "tz")?.value).toBe("Asia/Seoul");

      // 다시 방문: 서버가 쿠키의 시간대로 그려 hydration 과 어긋나지 않는다.
      const again = await seoul.goto(path);
      const html = (await again?.text()) ?? "";
      expect(html).toContain(timeIn("Asia/Seoul"));
      expect(html).not.toContain(timeIn("UTC"));
      await hydrated(seoul);
      expect(consoleErrors.filter((text) => /hydrat/i.test(text))).toEqual([]);
    } finally {
      await context.close();
    }
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
  // 온보딩(0026)을 마친 설치로 둔다. GitHub 토큰이 없으면 모든 화면이 온보딩으로 간다
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
    inProgressStateId: null,
  });
  saveMapping(db, { connection, trackerProject, runnerProject, agent });

  const projects = [{ id: runnerProject, displayName: "acme/web", setupState: "ready" as const }];
  saveRunner(db, { id: runnerId, kind: runnerKind, name: "runner-a", config: {}, capacity: 4 });
  recordRunnerCheck(db, {
    runnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects,
    assignmentBlocked: false,
  });

  // 질문을 기다리는 런: 손댈 일에 오른다
  questionRun = startRun(toTicketKey("ACME-1"));
  ok(changeRunState(db, questionRun, { to: "waiting-for-input" }));
  recordRunQuestions(db, questionRun, [
    { id: questionId, body: questionBody, options: [], askedAt: new Date() },
  ]);

  // 실행 중인 런: Run 상세에서 취소한다
  runningRun = startRun(toTicketKey("ACME-2"));
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
  return assigned.run.id;
}

function ok(result: { ok: true } | { ok: false; error: unknown }): void {
  if (!result.ok) throw new Error(`state change failed: ${JSON.stringify(result.error)}`);
}

function runsOf(key: TicketKey) {
  return listRuns(db, { workspaceId }).filter((r) => r.ticket.key === key);
}

/** 화면 문구의 {name} 자리를 채운다 */
function fill(message: string, values: Record<string, string>): string {
  return message.replace(/\{(\w+)\}/g, (all, name: string) => values[name] ?? all);
}

/**
 * 서버 렌더한 화면에 React 가 붙을 때까지 기다린다. 붙기 전에 누르면 클릭이 사라진다.
 * TanStack Router 는 하이드레이션이 끝나면 window.__TSR_ROUTER__ 를 둔다.
 */
async function hydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await page.waitForLoadState("networkidle");
}
