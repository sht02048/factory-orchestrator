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
  getRunWithRecords,
  listRuns,
  migrate,
  openDatabase,
  recordAgentCheck,
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
} from "@ganger/db";
import type { Database } from "@ganger/db";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed } from "vitest";
import run from "../../apps/web/messages/ko/run.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const runnerProject = toRunnerProjectId("fake:acme/web");
const runnerId = toRunnerId("runner-a");
const agent = toAgentId("claude");
const encryptionKey = new Uint8Array(32).fill(7);
const NARROW_WIDTH = 400;

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let page: Page;
let ticketNumber = 100;

const fakeAdapters: Plugin = {
  name: "continue-run-fake-adapters",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (importer === undefined || !source.endsWith("/adapters")) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved?.id === adaptersModule ? fakeAdaptersModule : null;
  },
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ganger-continue-run-"));
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

describe("이어서 맡기기(브라우저, 0149)", () => {
  it("키보드로 맡기면 새 런이 Queued 로 생기고 포커스가 결과 문장으로 간다", async () => {
    const source = keptRun();
    await open(source);
    await page.getByRole("button", { name: run.continue.trigger }).press("Enter");
    const dialog = page.getByRole("dialog", { name: run.continue.title });
    await dialog.getByText("같은 워크트리와 브랜치", { exact: false }).waitFor();
    await dialog.getByLabel(run.continue.messageLabel).fill("남은 push와 PR을 마무리해 주세요.");
    await dialog.getByRole("button", { name: run.continue.confirm }).press("Enter");

    const result = page.getByRole("status").filter({ hasText: "런 #2에 이어서 맡겼어요" });
    await result.waitFor();
    await expect.poll(() => result.evaluate((e) => e === document.activeElement)).toBe(true);
    expect(await page.getByRole("dialog").count()).toBe(0);

    const next = listRuns(db, { order: "newest", limit: 1 })[0];
    expect(next).toMatchObject({ state: "queued", continuedFromRunId: source, runnerId });
    if (next === undefined) throw new Error("no continued run");
    expect(getRunWithRecords(db, next.id)?.records.continueMessage).toBe(
      "남은 push와 PR을 마무리해 주세요.",
    );

    await open(next.id);
    await page.getByRole("link", { name: "런 #1을 이어서" }).waitFor();
    await page.getByText(run.continuation.place.pending).waitFor();
  });

  it("할 말이 비어 있으면 대화상자를 닫지 않고 안내하며 런을 만들지 않는다", async () => {
    const source = keptRun();
    const before = listRuns(db).length;
    await open(source);
    await page.getByRole("button", { name: run.continue.trigger }).click();
    const dialog = page.getByRole("dialog", { name: run.continue.title });
    await dialog.getByRole("button", { name: run.continue.confirm }).click();

    await dialog.getByText(run.continue.messageRequired).waitFor();
    expect(listRuns(db).length).toBe(before);
  });

  it("이전 에이전트가 떠 있으면 맡길 수 없고, 멈추기를 누르면 포커스가 상태 문장으로 간다", async () => {
    const source = keptRun();
    recordAgentCheck(db, source, "alive", { stopHandled: true });
    await open(source);
    await page.getByText(run.continue.blocked.alive).waitFor();
    const trigger = page.getByRole("button", { name: run.continue.trigger });
    expect(await trigger.getAttribute("aria-disabled")).toBe("true");
    await trigger.click({ force: true });
    expect(await page.getByRole("dialog").count()).toBe(0);

    await page.getByRole("button", { name: run.continue.stop }).press("Enter");

    const status = page.getByRole("status").filter({ hasText: run.continue.stopPending });
    await status.waitFor();
    await expect.poll(() => status.evaluate((e) => e === document.activeElement)).toBe(true);
    expect(getRunWithRecords(db, source)?.records.agentStopRequestedAt).not.toBeNull();
  });

  it("400px 화면에서 대화상자와 Run 상세가 가로로 넘치지 않는다", async () => {
    await page.setViewportSize({ width: NARROW_WIDTH, height: 720 });
    const source = keptRun();
    await open(source);
    await page.getByRole("button", { name: run.continue.trigger }).click();
    const dialog = page.getByRole("dialog", { name: run.continue.title });
    await dialog.getByLabel(run.continue.messageLabel).waitFor();

    const box = await dialog.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(NARROW_WIDTH);
    const confirm = await dialog.getByRole("button", { name: run.continue.confirm }).boundingBox();
    expect((confirm?.y ?? 0) + (confirm?.height ?? 0)).toBeLessThanOrEqual(720);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

async function open(runId: RunId): Promise<void> {
  await page.goto(`/runs/${runId}?ws=${workspaceId}`);
  await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await page.waitForLoadState("networkidle");
}

function keptRun(): RunId {
  ticketNumber += 1;
  const key = `ACME-${ticketNumber}`;
  const assigned = assignRun(db, {
    ticket: { connection, key: toTicketKey(key) },
    trackerProject,
    runnerProject,
    agent,
    runnerId,
  });
  if (!assigned.ok) throw new Error(`assign ${key} failed: ${assigned.reason}`);
  const id = assigned.run.id;
  ok(
    changeRunState(db, id, {
      to: "running",
      started: {
        worktree: toWorktreeRef(`wt-${key}`),
        branch: `acme/wt-${key}`,
        agentRef: toAgentRef(`agent-${key}`),
      },
    }),
  );
  ok(
    changeRunState(db, id, {
      to: "ended",
      agentResult: "reported-success",
      prState: "none",
      reportBody: "커밋했어요. push가 남았어요.",
    }),
  );
  updateRunRecords(db, id, { worktreeKept: "unpushed-commits" });
  recordAgentCheck(db, id, "gone", { stopHandled: true });
  return id;
}

function ok(result: { ok: true } | { ok: false; error: unknown }): void {
  if (!result.ok) throw new Error(`state change failed: ${JSON.stringify(result.error)}`);
}

function seed(target: Database): void {
  saveTrackerConnection(target, new SecretBox(encryptionKey), {
    id: connection,
    kind: fakeKind,
    name: "Acme",
    config: {},
    secrets: { apiKey: "secret" },
  });
  saveCodeHostConnection(target, new SecretBox(encryptionKey), {
    id: toCodeHostConnectionId("github"),
    kind: toCodeHostKind("github"),
    name: "github",
    config: {},
    secrets: { token: "github_pat_example" },
  });
  saveWorkspace(target, { id: workspaceId, name: "Acme" });
  saveWorkspaceTrackerProject(target, {
    workspaceId,
    connection,
    projectId: trackerProject,
    name: "Web",
    inProgressStateId: toTrackerStateId("in-progress"),
  });
  saveMapping(target, { connection, trackerProject, runnerProject, agent });
  saveAutoAssignLabel(target, { workspaceId, connection, labelId: toLabelId("factory") });
  saveRunner(target, {
    id: runnerId,
    kind: toRunnerKind("fake"),
    name: "runner-a",
    config: {},
    capacity: 8,
  });
  recordRunnerCheck(target, {
    runnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects: [{ id: runnerProject, displayName: "acme/web", setupState: "ready" }],
    assignmentBlocked: false,
  });
}
