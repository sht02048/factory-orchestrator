import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AdapterRegistry,
  toAgentId,
  toCodeHostKind,
  toPullRequestId,
  toRepoRef,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTicketKey,
  toTrackerConnectionId,
  toTrackerKind,
  toTrackerProjectId,
  toTrackerStateId,
} from "@factory/core";
import type { AgentResult, PrState, RunId, SummaryOutcome } from "@factory/core";
import { FakeCodeHost, FakeRunner, FakeTracker } from "@factory/core/testing";
import {
  SecretBox,
  assignRun,
  getMapping,
  getRun,
  getRunWithRecords,
  listRunStateChanges,
  migrate,
  openDatabase,
  recordRunnerCheck,
  saveCodeHostConnection,
  saveMapping,
  saveRunner,
  saveTrackerConnection,
  saveWorkspace,
  saveWorkspaceTrackerProject,
  toCodeHostConnectionId,
  toWorkspaceId,
} from "@factory/db";
import type { Database, StoredRun } from "@factory/db";
import { startWorker } from "@factory/worker";
import type { RunningWorker } from "@factory/worker";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import domain from "../../apps/web/messages/ko/domain.json" with { type: "json" };

/*
 * 끝에서 끝까지 얇은 경로(티켓 0008). 가짜 어댑터로
 * 할당 → Queued → Running → Ended(두 축 기록) → Runs 화면 표시가 실제로 이어지는지 본다.
 *
 * - 임시 SQLite 파일 하나를 web 과 worker 가 함께 쓴다(ADR 0002).
 * - worker 는 0006 이 내보낸 startWorker 로 띄우고 core 가짜 어댑터를 registry 로 주입한다.
 * - web 은 apps/web 의 vite 설정 그대로 개발 서버를 띄우고 Runs 화면을 HTTP 로 받아 서버 렌더 결과를 읽는다.
 * - 러너의 Online 상태와 러너 쪽 프로젝트 목록은 러너 상태 확인(0016) 전이라 DB 에 직접 넣는다.
 *
 * 가상 값만 쓴다(acme, example.com).
 */

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const fakeKind = "fake";
const connection = toTrackerConnectionId("conn-acme");
const workspaceId = toWorkspaceId("ws-acme");
const trackerProject = toTrackerProjectId("tp-web");
const runnerProject = toRunnerProjectId("fake:acme/web");
const repo = toRepoRef("acme/web");
const runnerId = toRunnerId("runner-a");
const encryptionKey = new Uint8Array(32).fill(7);

/** 시나리오 하나: 에이전트가 끝난 방식과 그때의 PR, 기대하는 두 축과 요약 결과 */
interface Scenario {
  key: string;
  exitCode: number;
  pr: "open" | "merged" | "closed" | null;
  agentResult: AgentResult;
  prState: PrState;
  summary: SummaryOutcome;
}

const scenarios: ReadonlyArray<Scenario> = [
  {
    key: "ACME-1",
    exitCode: 0,
    pr: "merged",
    agentResult: "exited-normally",
    prState: "merged",
    summary: "merged",
  },
  {
    key: "ACME-2",
    exitCode: 1,
    pr: "open",
    agentResult: "exited-with-error",
    prState: "open",
    summary: "human-check",
  },
  {
    key: "ACME-3",
    exitCode: 0,
    pr: null,
    agentResult: "exited-normally",
    prState: "none",
    summary: "failed",
  },
];

let dir: string;
let db: Database;
let worker: RunningWorker;
let web: ViteDevServer;
let baseUrl: string;
const tracker = new FakeTracker(toTrackerKind(fakeKind));
const codeHost = new FakeCodeHost(toCodeHostKind(fakeKind));
const runner = new FakeRunner(toRunnerKind(fakeKind));
const warnings: unknown[] = [];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "factory-e2e-"));
  const dbPath = join(dir, "factory.db");
  db = openDatabase(dbPath);
  migrate(db);
  seed(db);

  worker = startWorker({
    dbPath,
    registry: new AdapterRegistry()
      .registerTracker({ kind: toTrackerKind(fakeKind), create: () => tracker })
      .registerCodeHost({ kind: toCodeHostKind(fakeKind), create: () => codeHost })
      .registerRunner({ kind: toRunnerKind(fakeKind), create: () => runner }),
    secretBox: new SecretBox(encryptionKey),
    pollIntervalMs: 20,
    logger: { warn: (message, fields) => warnings.push({ message, fields }) },
  });

  // web 은 부팅 설정(환경 변수)으로 DB 를 연다(packages/db parseBootConfig).
  process.env["DATABASE_PATH"] = dbPath;
  process.env["ENCRYPTION_KEY"] = Buffer.from(encryptionKey).toString("base64");
  web = await createServer({
    root: webRoot,
    configFile: join(webRoot, "vite.config.ts"),
    logLevel: "warn",
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: null },
  });
  await web.listen();
  const address = web.httpServer?.address();
  if (address === null || address === undefined || typeof address === "string") {
    throw new Error("web dev server has no TCP address");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 120_000);

afterAll(async () => {
  await web?.close();
  await worker?.stop();
  db?.$client.close();
  delete process.env["DATABASE_PATH"];
  delete process.env["ENCRYPTION_KEY"];
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

describe("끝에서 끝까지 얇은 경로", () => {
  for (const scenario of scenarios) {
    it(`할당한 런이 끝나 ${scenario.summary} 로 Runs 화면에 보인다`, async () => {
      const assigned = assign(scenario.key);
      expect(assigned.state).toBe("queued");

      // worker 가 대기열에서 꺼내 러너에서 시작한다.
      const running = await waitForRun(assigned.id, (run) => run.state === "running");
      if (running.state !== "running") throw new Error("unreachable");

      // 에이전트가 PR 을 남기고(또는 남기지 않고) 끝난다.
      if (scenario.pr !== null) putPullRequest(running, scenario.pr);
      runner.setProgress(running.worktree, { kind: "finished", exitCode: scenario.exitCode });

      // worker 가 두 축을 한 번 기록한다.
      const ended = await waitForRun(assigned.id, (run) => run.state === "ended");
      if (ended.state !== "ended") throw new Error("unreachable");
      expect([ended.agentResult, ended.prState]).toEqual([scenario.agentResult, scenario.prState]);
      expect(listRunStateChanges(db, assigned.id).map((change) => change.to)).toEqual([
        "queued",
        "running",
        "ended",
      ]);
      const records = getRunWithRecords(db, assigned.id)?.records;
      expect(records?.pullRequest?.displayId ?? null).toBe(scenario.pr === null ? null : "#pr");

      // Runs 화면이 DB 에서 읽어 두 칸과 요약 결과를 보인다.
      const html = await fetchRuns(assigned.id);
      expect(rowCells(html, scenario.key)).toEqual([
        domain.summary[scenario.summary],
        domain.agentResult[scenario.agentResult],
        domain.prState[scenario.prState],
      ]);
      const panel = panelText(html);
      expect(panel).toContain(domain.summary[scenario.summary]);
      expect(panel).toContain(domain.agentResult[scenario.agentResult]);
      expect(panel).toContain(domain.prState[scenario.prState]);
    });
  }

  it("worker 가 경고 없이 돌았다", () => {
    expect(warnings).toEqual([]);
  });
});

function seed(db: Database): void {
  const secretBox = new SecretBox(encryptionKey);
  saveTrackerConnection(db, secretBox, {
    id: connection,
    kind: toTrackerKind(fakeKind),
    name: "Acme",
    config: {},
    secrets: { apiKey: "secret" },
  });
  saveCodeHostConnection(db, secretBox, {
    id: toCodeHostConnectionId("code-acme"),
    kind: toCodeHostKind(fakeKind),
    name: "Acme",
    config: {},
    secrets: { token: "secret" },
  });
  saveWorkspace(db, { id: workspaceId, name: "Acme" });
  saveWorkspaceTrackerProject(db, {
    workspaceId,
    connection,
    projectId: trackerProject,
    name: "Web",
    inProgressStateId: null,
  });
  saveMapping(db, { connection, trackerProject, runnerProject, agent: toAgentId("claude") });

  const projects = [{ id: runnerProject, displayName: "acme/web", setupState: "ready" as const }];
  runner.setProjects(projects);
  saveRunner(db, {
    id: runnerId,
    kind: toRunnerKind(fakeKind),
    name: "runner-a",
    config: {},
    capacity: 1,
  });
  recordRunnerCheck(db, {
    runnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects,
  });
}

/** 트래커에 티켓을 넣고 Mapping 대로 db 할당 진입점(assignRun)으로 런을 만든다. */
function assign(key: string): StoredRun {
  const ticketKey = toTicketKey(key);
  tracker.addTicket({
    key: ticketKey,
    title: `Ticket ${key}`,
    body: "Do the thing.",
    url: `https://tracker.example.com/${key}`,
    labels: [],
    project: { id: trackerProject, name: "Web" },
    state: { id: toTrackerStateId("todo"), name: "Todo", category: "unstarted" },
    updatedAt: new Date(),
  });
  const mapping = getMapping(db, connection, trackerProject);
  if (mapping === null) throw new Error("mapping is missing");
  const result = assignRun(db, {
    ticket: { connection, key: ticketKey },
    trackerProject,
    runnerProject: mapping.runnerProject,
    agent: mapping.agent,
  });
  if (!result.ok) throw new Error(`assign ${key} failed: ${result.reason}`);
  return result.run;
}

/** 런의 브랜치로 PR 을 둔다. 에이전트가 PR 을 열고, 병합하거나 닫은 결과를 흉내 낸다. */
function putPullRequest(run: StoredRun, state: "open" | "merged" | "closed"): void {
  const now = new Date();
  codeHost.putPullRequest(repo, {
    id: toPullRequestId(`pr-${run.ticket.key}`),
    displayId: "#pr",
    url: "https://code.example.com/acme/web/pull/1",
    title: `${run.ticket.key}: change`,
    body: "",
    state,
    createdAt: now,
    mergedAt: state === "merged" ? now : null,
    headBranch: run.branch,
    sourceRepo: repo,
    headCommit: "abc123",
    baseBranch: "main",
    ci: "success",
  });
}

async function waitForRun(
  id: RunId,
  done: (run: StoredRun) => boolean,
  timeoutMs = 10_000,
): Promise<StoredRun> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = getRun(db, id);
    if (run !== null && done(run)) return run;
    if (Date.now() > deadline) {
      throw new Error(`run ${id} did not reach the expected state: ${JSON.stringify(run)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function fetchRuns(selected: RunId): Promise<string> {
  const url = new URL("/runs", baseUrl);
  url.searchParams.set("ws", workspaceId);
  url.searchParams.set("sel", selected);
  const response = await fetch(url);
  expect(response.status).toBe(200);
  return response.text();
}

/** 목록에서 티켓 키 행의 상태·에이전트 결과·PR 상태 칸. 태그를 지우고 빈 칸과 속성 조각은 버린다. */
function rowCells(html: string, key: string): string[] | undefined {
  for (const chunk of html.split('role="option"').slice(1)) {
    const cells = chunk
      .split(/<[^>]+>/)
      .map((s) => s.trim())
      .filter((s) => s !== "" && !s.includes("="));
    if (cells[0] === key) return cells.slice(1, 4);
  }
  return undefined;
}

/** 상세 패널(aside) 안의 글 */
function panelText(html: string): string {
  const panel = html.split("<aside")[1] ?? "";
  return panel.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}
