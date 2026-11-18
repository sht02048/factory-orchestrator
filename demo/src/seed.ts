import {
  isAssignmentBlocked,
  toAgentId,
  toAgentRef,
  toCommentId,
  toPermissionRequestId,
  toPullRequestId,
  toQuestionId,
  toTicketKey,
  toWorktreeRef,
} from "@factory/core";
import type { AgentId, AgentResult, PrState, RunId, RunnerId, TicketKey } from "@factory/core";
import {
  assignRun,
  changeRunState,
  inTransaction,
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
import type { Database, SecretBox } from "@factory/db";
import {
  RUNNER_PROJECTS,
  agent,
  autoAssignLabel,
  inProgressState,
  runnerProjectId,
  seededConnections,
  seededRunners,
  trackerProjectId,
} from "./fixtures.js";
import { PREFILL } from "./values.js";
import { CODE_HOST_KIND, RUNNER_KIND, TRACKER_KIND } from "./world.js";
import type { DemoWorld } from "./world.js";

/*
 * 미리 채운 모드의 시드(티켓 0047). 온보딩을 마친 설치와, 런의 모든 상태와 지난 2주의 끝난 런을 DB 에 쓴다.
 * worker 가 하는 일(시작, 질문 기록, 끝내기)을 db 진입점으로 직접 쓴다. 가짜 러너·코드 호스트의 상태는
 * 쓰지 않는다. 띄울 때마다 DB 에서 다시 만든다(hydrate.ts).
 *
 * 값은 가상 값만 쓰고(ADR 0005), 지난 런은 고정 씨앗의 난수로 만들어 띄울 때마다 같은 모양이다.
 */

const HOUR = 3_600_000;
const MINUTE = 60_000;
const DAY = 24 * HOUR;
/** 통계에 보일 지난 기간 */
export const HISTORY_DAYS = 14;

/** 시드가 만든 진행 중인 런. 시험과 스크린샷이 찾는다 */
export interface SeededRuns {
  queued: RunId[];
  running: RunId[];
  question: RunId;
  permission: RunId;
  disconnected: RunId;
}

export async function seedDemo(
  db: Database,
  box: SecretBox,
  world: DemoWorld,
  now: Date,
): Promise<SeededRuns> {
  seedSettings(db, box, now);
  // 지난 런은 러너 상태와 상관없이 고른 러너로 만든다. 그동안은 모든 러너를 멀쩡하게 두고, 뒤에 실제 확인 결과를 쓴다.
  for (const runner of seededRunners) {
    recordRunnerCheck(db, {
      runnerId: runner.id,
      online: true,
      checkedAt: now,
      error: null,
      projects: RUNNER_PROJECTS,
      assignmentBlocked: false,
    });
  }
  inTransaction(db, () => seedHistory(db, now));
  const active = inTransaction(db, () => seedActive(db, now));
  for (const runner of seededRunners) {
    const fake = world.runner(runner.sshTarget);
    const health = await fake.checkHealth();
    recordRunnerCheck(db, {
      runnerId: runner.id,
      online: health.online,
      checkedAt: now,
      error: health.error,
      projects: health.online ? await fake.listProjects() : null,
      assignmentBlocked: isAssignmentBlocked(health),
      prerequisites: health.prerequisites,
    });
  }
  return active;
}

function seedSettings(db: Database, box: SecretBox, now: Date): void {
  for (const connection of seededConnections) {
    saveTrackerConnection(
      db,
      box,
      {
        id: connection.id,
        kind: TRACKER_KIND,
        name: connection.spec.name,
        config: {},
        secrets: { apiKey: connection.apiKey, webhookSecret: connection.webhookSecret },
      },
      now,
    );
    saveWorkspace(db, { id: connection.workspaceId, name: connection.spec.name }, now);
    for (const project of connection.spec.projects) {
      saveWorkspaceTrackerProject(db, {
        workspaceId: connection.workspaceId,
        connection: connection.id,
        projectId: trackerProjectId(project),
        name: project.name,
        inProgressStateId: inProgressState,
      });
      saveMapping(db, {
        connection: connection.id,
        trackerProject: trackerProjectId(project),
        runnerProject: runnerProjectId(project),
        agent,
        model: project.repo.endsWith("api") ? "sonnet" : "opus",
      });
    }
    saveAutoAssignLabel(db, {
      workspaceId: connection.workspaceId,
      connection: connection.id,
      labelId: autoAssignLabel,
    });
  }
  saveCodeHostConnection(
    db,
    box,
    {
      id: toCodeHostConnectionId(CODE_HOST_KIND),
      kind: CODE_HOST_KIND,
      name: CODE_HOST_KIND,
      config: {},
      secrets: { token: PREFILL["token"] ?? "github_pat_demo" },
    },
    now,
  );
  for (const runner of seededRunners) {
    saveRunner(
      db,
      {
        id: runner.id,
        kind: RUNNER_KIND,
        name: runner.name,
        config: { sshTarget: runner.sshTarget, orcaPath: "orca" },
        capacity: runner.capacity,
      },
      now,
    );
  }
}

// ---------- 런 만들기 ----------

interface Ticket {
  connection: (typeof seededConnections)[number];
  project: (typeof seededConnections)[number]["spec"]["projects"][number];
  key: TicketKey;
}

/** 시드 연결의 티켓을 키로 찾는다. 키는 fixtures.ts trackerCatalog 와 같은 규칙이다 */
function ticket(prefix: string, n: number): Ticket {
  for (const connection of seededConnections) {
    if (connection.spec.keyPrefix !== prefix) continue;
    let index = n;
    for (const project of connection.spec.projects) {
      if (index <= project.titles.length) {
        return { connection, project, key: toTicketKey(`${prefix}-${n}`) };
      }
      index -= project.titles.length;
    }
  }
  throw new Error(`no demo ticket ${prefix}-${n}`);
}

function assign(
  db: Database,
  t: Ticket,
  input: { at: Date; runnerId: RunnerId | null; agentId?: AgentId },
): { id: RunId; worktreeName: string } {
  const result = assignRun(db, {
    ticket: { connection: t.connection.id, key: t.key },
    trackerProject: trackerProjectId(t.project),
    runnerProject: runnerProjectId(t.project),
    agent: input.agentId ?? agent,
    model: t.project.repo.endsWith("api") ? "sonnet" : "opus",
    ...(input.runnerId === null ? {} : { runnerId: input.runnerId }),
    now: input.at,
  });
  if (!result.ok) throw new Error(`could not assign ${t.key}: ${result.reason}`);
  return { id: result.run.id, worktreeName: result.run.worktreeName };
}

/** 가짜 러너(FakeRunner.startRun)와 같은 모양으로 시작한 값을 쓴다 */
function start(db: Database, runId: RunId, worktreeName: string, at: Date): void {
  ok(
    changeRunState(
      db,
      runId,
      {
        to: "running",
        started: {
          worktree: toWorktreeRef(`fake::/fake/${worktreeName}`),
          branch: `fake/${worktreeName}`,
          agentRef: toAgentRef(`fake-agent-${worktreeName}`),
        },
      },
      at,
    ),
  );
  updateRunRecords(db, runId, { trackerStateSetAt: at });
}

function ok(result: { ok: true } | { ok: false; error: unknown }): void {
  if (!result.ok) throw new Error(`demo seed state change failed: ${JSON.stringify(result.error)}`);
}

interface Ending {
  agentResult: AgentResult;
  prState: PrState;
  /** PR 이 병합되거나 닫히기 전까지 워크트리를 남기는지 */
  keepWorktree: boolean;
}

/** 시작한 런을 끝내고 worker 뒤처리(댓글, PR, 워크트리 정리)를 마친 것으로 기록한다 */
function end(
  db: Database,
  runId: RunId,
  input: { ending: Ending; at: Date; prNumber: number; repo: string },
): void {
  const { ending, at } = input;
  ok(
    changeRunState(
      db,
      runId,
      {
        to: "ended",
        agentResult: ending.agentResult,
        prState: ending.prState,
        ...(ending.agentResult.startsWith("reported")
          ? { reportBody: "Done. Opened a pull request with the change and tests." }
          : {}),
      },
      at,
    ),
  );
  updateRunRecords(db, runId, {
    trackerComment: { id: toCommentId(`demo-comment-${runId}`), at },
    worktreeRemovedAt: ending.keepWorktree ? null : at,
    lastLog: ["$ pnpm test", "✓ 42 tests passed", "$ git push", "done"],
    ...(ending.prState === "none"
      ? {}
      : {
          pullRequest: {
            id: toPullRequestId(`pr-${input.prNumber}`),
            displayId: `#${input.prNumber}`,
            url: `https://code.example.com/${input.repo}/pull/${input.prNumber}`,
            ci: "success",
            checkedAt: at,
          },
        }),
  });
}

/** 진행 중인 런(seedActive)이 쓰는 티켓 번호. 지난 런은 이 번호를 쓰지 않는다 */
const ACTIVE_TICKETS = { ACME: [1, 2, 3, 4, 5, 6, 7, 21, 22, 23], GLX: [2] };
const HISTORY_TICKETS = [
  range(1, 35).filter((n) => !ACTIVE_TICKETS.ACME.includes(n)),
  range(1, 10).filter((n) => !ACTIVE_TICKETS.GLX.includes(n)),
] as const;

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** 지난 2주의 끝난 런. 통계(처리량, 결과 비율, 걸린 시간)가 의미 있게 보일 만큼 만든다 */
function seedHistory(db: Database, now: Date): void {
  const random = mulberry32(47);
  const pick = <T>(items: ReadonlyArray<T>): T => {
    const item = items[Math.floor(random() * items.length)];
    if (item === undefined) throw new Error("empty pick");
    return item;
  };
  const runners = [seededRunners[0].id, seededRunners[0].id, seededRunners[1].id];
  let prNumber = 100;
  for (let daysAgo = HISTORY_DAYS; daysAgo >= 0; daysAgo -= 1) {
    const dayStart = startOfDay(now).getTime() - daysAgo * DAY;
    // 주말은 적게
    const weekday = new Date(dayStart).getUTCDay();
    const count =
      weekday === 0 || weekday === 6 ? 1 + Math.floor(random() * 2) : 3 + Math.floor(random() * 5);
    for (let i = 0; i < count; i += 1) {
      const assignedAt = new Date(dayStart + (8 + random() * 10) * HOUR);
      const startedAt = new Date(assignedAt.getTime() + (1 + random() * 6) * MINUTE);
      const endedAt = new Date(startedAt.getTime() + (8 + random() * 80) * MINUTE);
      // 오늘 아직 오지 않은 시각은 만들지 않는다
      if (endedAt.getTime() > now.getTime() - 30 * MINUTE) continue;
      const prefix = random() < 0.75 ? "ACME" : "GLX";
      // 진행 중인 런(seedActive)의 티켓은 피한다. 같은 티켓의 지난 PR 이 진행 중인 런의 PR 로 잡힌다.
      const t = ticket(prefix, pick(HISTORY_TICKETS[prefix === "ACME" ? 0 : 1]));
      const run = assign(db, t, {
        at: assignedAt,
        runnerId: pick(runners),
        agentId: random() < 0.8 ? agent : toAgentId("codex"),
      });
      const roll = random();
      const ending: Ending =
        roll < 0.58
          ? { agentResult: "reported-success", prState: "merged", keepWorktree: false }
          : roll < 0.68 && daysAgo <= 2
            ? { agentResult: "reported-success", prState: "open", keepWorktree: true }
            : roll < 0.74
              ? { agentResult: "reported-failure", prState: "none", keepWorktree: false }
              : roll < 0.8
                ? { agentResult: "ended-without-report", prState: "none", keepWorktree: false }
                : roll < 0.85
                  ? { agentResult: "timed-out", prState: "none", keepWorktree: false }
                  : roll < 0.9
                    ? { agentResult: "reported-success", prState: "closed", keepWorktree: false }
                    : { agentResult: "canceled", prState: "none", keepWorktree: false };
      start(db, run.id, run.worktreeName, startedAt);
      prNumber += 1;
      end(db, run.id, { ending, at: endedAt, prNumber, repo: t.project.repo });
    }
  }
}

/** 진행 중인 런과 오늘 끝난 런. 모든 런 상태와 요약 결과가 하나 이상 있다 */
function seedActive(db: Database, now: Date): SeededRuns {
  const [runnerA, runnerB, runnerC] = seededRunners;
  const ago = (minutes: number) => new Date(now.getTime() - minutes * MINUTE);

  // Running: runner-a 와, GitHub 인증이 깨지기 전에 시작한 runner-b
  const running = [
    startedRun(db, ticket("ACME", 1), runnerA.id, ago(25), ago(24)),
    startedRun(db, ticket("ACME", 21), runnerB.id, ago(50), ago(48)),
  ];

  // Waiting for Input(질문)
  const question = startedRun(db, ticket("ACME", 2), runnerA.id, ago(40), ago(39));
  ok(changeRunState(db, question, { to: "waiting-for-input" }, ago(12)));
  recordRunQuestions(db, question, [
    {
      id: toQuestionId("demo-question-1"),
      body: "The cache can live in SQLite or in memory. Which one should the health check use?",
      options: ["SQLite", "In memory"],
      askedAt: ago(12),
    },
  ]);

  // Waiting for Input(권한 대기)
  const permission = startedRun(db, ticket("ACME", 22), runnerA.id, ago(35), ago(34));
  ok(changeRunState(db, permission, { to: "waiting-for-input" }, ago(6)));
  recordPermissionWaits(db, permission, [
    {
      id: toPermissionRequestId("demo-permission-1"),
      detail: "Bash(pnpm add -D @types/supertest)",
      requestedAt: ago(6),
    },
  ]);

  // Disconnected: Offline 러너에서 돌던 런
  const disconnected = startedRun(db, ticket("ACME", 23), runnerC.id, ago(45), ago(44));
  updateRunRecords(db, disconnected, { unreachableSince: ago(20) });
  ok(changeRunState(db, disconnected, { to: "disconnected" }, ago(15)));

  // Queued: runner-a 가 가득 찼고(capacity 3) 다른 러너는 받을 수 없어 기다린다
  const queued = [
    assign(db, ticket("ACME", 3), { at: ago(8), runnerId: null }).id,
    assign(db, ticket("GLX", 2), { at: ago(4), runnerId: null }).id,
  ];

  // 오늘 끝난 런: 요약 결과 넷
  const endings: Array<[number, Ending]> = [
    [4, { agentResult: "reported-success", prState: "merged", keepWorktree: false }],
    [5, { agentResult: "reported-success", prState: "open", keepWorktree: true }],
    [6, { agentResult: "ended-without-report", prState: "none", keepWorktree: false }],
    [7, { agentResult: "canceled", prState: "none", keepWorktree: false }],
  ];
  let prNumber = 900;
  for (const [n, ending] of endings) {
    const t = ticket("ACME", n);
    const runId = startedRun(db, t, runnerA.id, ago(200 - n * 20), ago(198 - n * 20));
    prNumber += 1;
    end(db, runId, { ending, at: ago(120 - n * 15), prNumber, repo: t.project.repo });
  }
  return { queued, running, question, permission, disconnected };
}

function startedRun(
  db: Database,
  t: Ticket,
  runnerId: RunnerId,
  assignedAt: Date,
  startedAt: Date,
): RunId {
  const run = assign(db, t, { at: assignedAt, runnerId });
  start(db, run.id, run.worktreeName, startedAt);
  return run.id;
}

function startOfDay(date: Date): Date {
  const day = new Date(date);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

/** 고정 씨앗 난수(mulberry32). 띄울 때마다 같은 지난 런을 만든다 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
