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
import type { RunId } from "@factory/core";
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
  updateRunRecords,
} from "@factory/db";
import type { Database } from "@factory/db";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import { createServer } from "vite";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed } from "vitest";
import run from "../../apps/web/messages/ko/run.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";

/*
 * Run 상세에서 답·거절·취소를 키보드로 보낸 뒤 포커스와 결과 안내가 남는지, 실패 문구가 alert 인지,
 * 로그 꼬리가 마지막 줄부터 보이는지 실제 브라우저로 본다(티켓 0051).
 *
 * 띄우는 방식은 operator-actions.test.ts(티켓 0039)와 같다. apps/web 의 vite 설정으로 개발 서버를 띄우고
 * playwright-core 로 설치된 Chrome 을 띄운다. worker 는 띄우지 않는다.
 * 시험이 실패하면 그때의 화면을 e2e/test-results 에 남긴다.
 */

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const runnerProject = toRunnerProjectId("fake:acme/web");
const runnerId = toRunnerId("runner-a");
const agent = toAgentId("claude");
const encryptionKey = new Uint8Array(32).fill(7);

/** 로그 꼬리 줄 수. 끝날 때 저장하는 최대 줄 수와 같다 */
const LOG_LINES = 200;

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let page: Page;
let questionRun: RunId;
let permissionRun: RunId;
let cancelRun: RunId;
let cancelFailsRun: RunId;
let endedRun: RunId;

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
  dir = mkdtempSync(join(tmpdir(), "factory-run-detail-"));
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

beforeEach(async (context) => {
  page = await browser.newPage({ baseURL: baseUrl, locale: "ko-KR" });
  page.setDefaultTimeout(30_000);
  const current = page;
  onTestFailed(async () => {
    mkdirSync(resultsDir, { recursive: true });
    const name = context.task.name.replace(/[^\p{L}\p{N}_-]+/gu, "-");
    await current.screenshot({ path: join(resultsDir, `${name}.png`), fullPage: true });
  });
});

describe("Run 상세 보내기 뒤 포커스와 안내(브라우저, 0051)", () => {
  it("질문에 키보드로 답하면 포커스가 body 가 아니고 결과 문장이 role=status 안에 있다", async () => {
    await open(questionRun);
    const card = page.getByRole("region", { name: run.question.title });
    const input = card.getByLabel(run.question.answerLabel);
    await input.fill("Use SQLite.");
    await input.press("Enter");

    await card.getByRole("status").getByText(run.question.sent).waitFor();
    await expect.poll(focusedStatusText).toBe(run.question.sent);
  });

  it("권한 요청을 키보드로 거절하면 포커스가 body 가 아니고 결과 문장이 role=status 안에 있다", async () => {
    await open(permissionRun);
    const card = page.getByRole("region", { name: run.permission.title });
    await card.getByLabel(run.permission.reasonLabel).press("Enter");

    await card.getByRole("status").getByText(run.permission.denied).waitFor();
    await expect.poll(focusedStatusText).toBe(run.permission.denied);
  });

  it("런 취소를 키보드로 확인하면 포커스가 상태 줄의 role=status 로 간다", async () => {
    await open(cancelRun);
    await page.getByRole("button", { name: run.cancel.trigger }).press("Enter");
    const dialog = page.getByRole("dialog", { name: run.cancel.title });
    await dialog.getByRole("button", { name: run.cancel.confirm }).press("Enter");

    await page.getByRole("status").getByText(run.cancelPending, { exact: true }).waitFor();
    await expect.poll(focusedStatusText).toBe(run.cancelPending);
  });

  it("요청을 남기지 못하면 실패 문구가 role=alert 로 보인다", async () => {
    await open(cancelFailsRun);
    // 화면을 연 뒤 런이 끝나 취소 요청이 거절되게 한다.
    ok(
      changeRunState(db, cancelFailsRun, {
        to: "ended",
        agentResult: "reported-success",
        prState: "merged",
      }),
    );
    await page.getByRole("button", { name: run.cancel.trigger }).press("Enter");
    const dialog = page.getByRole("dialog", { name: run.cancel.title });
    await dialog.getByRole("button", { name: run.cancel.confirm }).press("Enter");

    const alert = page.getByRole("alert").filter({ hasText: run.actionFailed });
    await alert.waitFor();
    expect(await alert.count()).toBe(1);
  });

  it("로그를 열면 마지막 줄이 보이고 키보드로 스크롤할 수 있다", async () => {
    await open(endedRun);
    const log = page.getByRole("region", { name: run.log.linesLabel });
    await log.waitFor();
    // e2e 는 DOM 타입을 싣지 않아 쓰는 값만 적는다. 넘쳐서 스크롤되고, 맨 아래에 있다
    const atBottom = await log.evaluate(
      (e: { scrollHeight: number; clientHeight: number; scrollTop: number }) =>
        e.scrollHeight > e.clientHeight && e.scrollTop + e.clientHeight >= e.scrollHeight - 1,
    );
    expect(atBottom).toBe(true);
    expect(await log.getAttribute("tabindex")).toBe("0");
  });
});

async function open(runId: RunId): Promise<void> {
  await page.goto(`/runs/${runId}?ws=${workspaceId}`);
  await hydrated(page);
}

/**
 * 포커스를 가진 요소나 그 조상인 role=status 의 글. 포커스가 body 에 있거나 status 밖이면 undefined.
 */
async function focusedStatusText(): Promise<string | undefined> {
  const focused = page.locator('[role="status"]:focus-within');
  if ((await focused.count()) !== 1) return undefined;
  return (await focused.textContent())?.trim();
}

function seed(db: Database): void {
  saveTrackerConnection(db, new SecretBox(encryptionKey), {
    id: connection,
    kind: fakeKind,
    name: "Acme",
    config: {},
    secrets: { apiKey: "secret" },
  });
  // 온보딩(0026)을 마친 설치로 둔다
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
    capacity: 8,
  });
  recordRunnerCheck(db, {
    runnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects: [{ id: runnerProject, displayName: "acme/web", setupState: "ready" }],
    assignmentBlocked: false,
  });

  questionRun = startRun("ACME-11");
  ok(changeRunState(db, questionRun, { to: "waiting-for-input" }));
  recordRunQuestions(db, questionRun, [
    {
      id: toQuestionId("q-1"),
      body: "Which database should the cache use?",
      options: [],
      askedAt: new Date(),
    },
  ]);

  permissionRun = startRun("ACME-12");
  ok(changeRunState(db, permissionRun, { to: "waiting-for-input" }));
  recordPermissionWaits(db, permissionRun, [
    { id: toPermissionRequestId("perm-1"), detail: "Bash: ls", requestedAt: new Date() },
  ]);

  cancelRun = startRun("ACME-13");
  cancelFailsRun = startRun("ACME-14");

  endedRun = startRun("ACME-15");
  ok(
    changeRunState(db, endedRun, {
      to: "ended",
      agentResult: "reported-success",
      prState: "merged",
    }),
  );
  updateRunRecords(db, endedRun, {
    lastLog: Array.from({ length: LOG_LINES }, (_, i) => `line ${i + 1}`),
  });
}

/** 런을 할당하고 러너에서 시작한 상태로 둔다(worker 가 하는 일을 DB 에 직접 쓴다) */
function startRun(key: string): RunId {
  const assigned = assignRun(db, {
    ticket: { connection, key: toTicketKey(key) },
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

/**
 * 서버 렌더한 화면에 React 가 붙을 때까지 기다린다. 붙기 전에 누르면 클릭이 사라진다.
 * TanStack Router 는 하이드레이션이 끝나면 window.__TSR_ROUTER__ 를 둔다.
 */
async function hydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await page.waitForLoadState("networkidle");
}
