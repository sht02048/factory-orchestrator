import { randomUUID } from "node:crypto";
import { toDeliveryId, toPullRequestId, toRepoRef, toTicketKey } from "@factory/core";
import type { TrackerConnectionId, TrackerTicket, WorktreeRef } from "@factory/core";
import type { FakeRunner, FakeRunnerRun, FakeTracker } from "@factory/core/testing";
import {
  listRunners,
  listRuns,
  listTrackerConnections,
  recordTrackerEvent,
  requestRunnerCheck,
} from "@factory/db";
import type { Database, SecretBox } from "@factory/db";
import { autoAssignLabel } from "./fixtures.js";
import { FAIL_PUSH_AUTH } from "./values.js";
import { pullRequestOf } from "./hydrate.js";
import { stringAt } from "./world.js";
import type { DemoWorld } from "./world.js";

/*
 * 가짜 러너의 에이전트를 시간에 따라 움직인다(티켓 0047). 러너에서 시작한 런은 잠시 일하다가 가끔 질문하고,
 * 답을 받으면 이어서 일한 뒤 PR 을 열고 완료 보고를 보낸다. 열어 둔 PR 은 조금 뒤 병합한다. 일감이 모자라면
 * 가짜 트래커의 티켓에 Auto-assign Label 을 붙여 자동 할당이 새 런을 만들게 한다.
 *
 * 개발 화면(/__dev)의 버튼도 같은 동작을 한 번씩 일으킨다. worker 는 실제 제품 코드 그대로 돌고, 여기서는
 * 러너·트래커·코드 호스트 쪽(가짜 어댑터)만 바꾼다.
 */

/** 런 하나가 일하는 시간(답을 기다린 시간은 빼고) */
const WORK_MS = { min: 40_000, max: 110_000 };
/** 열린 PR 을 병합하기까지 */
const MERGE_AFTER_MS = 90_000;
/** 일감을 더 만드는 간격과, 그때 진행 중인 런이 이보다 적어야 한다 */
const NEW_WORK_EVERY_MS = 60_000;
const BUSY_RUNS = 4;

const QUESTIONS = [
  {
    body: "Should the new endpoint require authentication?",
    options: ["Yes, require a session", "No, keep it public"],
  },
  { body: "The test suite has one flaky test. Fix it in this PR or skip it?", options: [] },
  { body: "Which date format should the export use?", options: ["ISO 8601", "Locale format"] },
];

interface Plan {
  workMs: number;
  ask: boolean;
  /** merged: 병합한 PR, open: 열린 PR(Human Check), failure: PR 없이 실패 보고, vanish: 보고 없이 사라짐 */
  outcome: "merged" | "open" | "failure" | "vanish";
}

interface Tracked {
  plan: Plan;
  /** 일한 시간(밀리초). 답을 기다리는 동안은 늘지 않는다 */
  worked: number;
  asked: boolean;
}

export interface LifeOptions {
  db: Database;
  secretBox: SecretBox;
  world: DemoWorld;
  now?: () => Date;
}

export class DemoLife {
  enabled = true;
  private readonly db: Database;
  private readonly secretBox: SecretBox;
  private readonly world: DemoWorld;
  private readonly now: () => Date;
  private readonly tracked = new Map<WorktreeRef, Tracked>();
  /** 병합할 열린 PR: 저장소, 런 키, 병합할 시각 */
  private readonly toMerge: Array<{ repo: string; worktree: WorktreeRef; at: number }> = [];
  private lastTick: number | null = null;
  private lastNewWork = 0;
  private ticketSeq = 1000;

  constructor(options: LifeOptions) {
    this.db = options.db;
    this.secretBox = options.secretBox;
    this.world = options.world;
    this.now = options.now ?? (() => new Date());
  }

  /** 한 걸음. 앞 걸음 뒤 지난 시간만큼 일을 진행한다 */
  tick(): void {
    const now = this.now().getTime();
    const elapsed = this.lastTick === null ? 0 : now - this.lastTick;
    this.lastTick = now;
    if (!this.enabled) return;
    for (const runner of this.world.runners.values()) {
      if (!runner.online) continue;
      for (const run of runner.runs.values()) this.step(runner, run, elapsed);
    }
    this.mergeDue(now);
    if (now - this.lastNewWork >= NEW_WORK_EVERY_MS) {
      this.lastNewWork = now;
      const active = listRuns(this.db, {
        states: ["queued", "running", "waiting-for-input"],
      }).length;
      if (active < BUSY_RUNS) this.labelTicket();
    }
  }

  private step(runner: FakeRunner, run: FakeRunnerRun, elapsed: number): void {
    if (run.report !== null || run.endedWithoutReport !== null || run.agentStopped) return;
    const worktree = run.started.worktree;
    let tracked = this.tracked.get(worktree);
    if (tracked === undefined) {
      tracked = {
        plan: planFor(run.input.worktreeName),
        worked: 0,
        asked: run.questions.length > 0,
      };
      this.tracked.set(worktree, tracked);
    }
    const waiting =
      run.permissionWaits.length > 0 ||
      run.questions.some((q) => !run.answers.some((a) => a.questionId === q.id));
    if (waiting) return;
    tracked.worked += elapsed;
    const { plan } = tracked;
    if (plan.ask && !tracked.asked && tracked.worked >= plan.workMs / 2) {
      tracked.asked = true;
      const question = QUESTIONS[hash(run.input.worktreeName) % QUESTIONS.length] ?? QUESTIONS[0];
      if (question !== undefined) runner.ask(worktree, question);
      runner.appendLog(worktree, "Waiting for an answer…");
      return;
    }
    if (tracked.worked < plan.workMs) {
      runner.appendLog(worktree, `Working… (${Math.round(tracked.worked / 1000)}s)`);
      return;
    }
    this.finish(runner, run, plan);
  }

  private finish(runner: FakeRunner, run: FakeRunnerRun, plan: Plan): void {
    const worktree = run.started.worktree;
    const repo = run.input.project;
    if (plan.outcome === "vanish") {
      runner.vanish(worktree);
      return;
    }
    if (plan.outcome === "merged" || plan.outcome === "open") {
      const number = 2000 + (hash(run.input.worktreeName) % 7000);
      const key = ticketKeyOf(run.input.worktreeName);
      const pr = pullRequestOf(
        {
          id: run.input.worktreeName,
          ticketKey: toTicketKey(key),
          runnerProject: repo,
          startedAt: new Date(this.now().getTime() - 5 * 60_000),
          branch: run.started.branch,
        },
        {
          id: toPullRequestId(`pr-${number}`),
          displayId: `#${number}`,
          url: `https://code.example.com/${repo}/pull/${number}`,
        },
      );
      // 런 시작 뒤에 만든 PR 이어야 찾는다. 시작 시각을 모르니 지금으로 둔다
      const created = { ...pr, createdAt: this.now() };
      if (plan.outcome === "merged") {
        this.world.codeHost.putPullRequest(toRepoRef(repo), {
          ...created,
          state: "merged",
          mergedAt: this.now(),
        });
      } else {
        this.world.codeHost.putPullRequest(toRepoRef(repo), { ...created, state: "open" });
        this.toMerge.push({ repo, worktree, at: this.now().getTime() + MERGE_AFTER_MS });
      }
    }
    runner.appendLog(worktree, "All tests passed.", "Sent the completion report.");
    runner.report(worktree, {
      outcome: plan.outcome === "failure" ? "failure" : "success",
      body:
        plan.outcome === "failure"
          ? "Could not reproduce the bug. Left notes in the ticket."
          : "Implemented the change and opened a pull request.",
    });
  }

  private mergeDue(now: number): void {
    for (let i = this.toMerge.length - 1; i >= 0; i -= 1) {
      const item = this.toMerge[i];
      if (item === undefined || item.at > now) continue;
      this.toMerge.splice(i, 1);
      void this.world.codeHost
        .findPullRequestsByBranch(toRepoRef(item.repo), branchOf(this.world, item.worktree))
        .then((prs) => {
          for (const pr of prs) {
            this.world.codeHost.putPullRequest(toRepoRef(item.repo), {
              ...pr,
              state: "merged",
              mergedAt: this.now(),
            });
          }
        });
    }
  }

  // ---------- 개발 화면의 동작 ----------

  /**
   * Auto-assign Label 이 없는 티켓 하나에 라벨을 붙이고 webhook 이 온 것처럼 이벤트를 쓴다. worker 의 자동 할당이
   * 다음 바퀴에 런을 만든다. 붙인 티켓 키를 돌려준다. 붙일 티켓이 없으면 새로 만든다.
   */
  labelTicket(): string | null {
    const target = this.trackerConnections()[0];
    if (target === undefined) return null;
    const busy = new Set(
      listRuns(this.db, { states: ["queued", "running", "waiting-for-input", "disconnected"] }).map(
        (run) => run.ticket.key,
      ),
    );
    const candidates = [...target.tracker.tickets.values()].filter(
      (ticket) =>
        !busy.has(ticket.key) &&
        ticket.state.category !== "completed" &&
        !ticket.labels.some((label) => label.id === autoAssignLabel),
    );
    const ticket = candidates[hash(String(this.now().getTime())) % Math.max(candidates.length, 1)];
    const chosen = ticket ?? this.addTicket();
    if (chosen === null) return null;
    const previous = chosen.labels.map((label) => label.id);
    const projectLabels =
      chosen.project === null ? [] : target.tracker.labels.get(chosen.project.id);
    const label = projectLabels?.find((l) => l.id === autoAssignLabel);
    const labeled: TrackerTicket = {
      ...chosen,
      labels: [...chosen.labels, label ?? { id: autoAssignLabel, name: "factory" }],
      updatedAt: this.now(),
    };
    target.tracker.addTicket(labeled);
    recordTrackerEvent(this.db, target.connection, {
      deliveryId: toDeliveryId(`demo-${randomUUID()}`),
      kind: "ticket.updated",
      ticketKey: labeled.key,
      projectId: labeled.project?.id ?? null,
      labelIds: labeled.labels.map((l) => l.id),
      previousLabelIds: previous,
      receivedAt: this.now(),
    });
    return labeled.key;
  }

  /** 첫 트래커 연결의 첫 프로젝트에 라벨 없는 티켓을 하나 만든다. Tickets 화면에서 수동 할당할 수 있다 */
  addTicket(): TrackerTicket | null {
    const target = this.trackerConnections()[0];
    const project = target?.tracker.projects[0];
    const todo = project === undefined ? undefined : target?.tracker.states.get(project.id)?.[1];
    if (target === undefined || project === undefined || todo === undefined) return null;
    const prefix = [...target.tracker.tickets.keys()][0]?.split("-")[0] ?? "DEMO";
    this.ticketSeq += 1;
    const key = toTicketKey(`${prefix}-${this.ticketSeq}`);
    const ticket: TrackerTicket = {
      key,
      title: `New demo ticket ${this.ticketSeq}`,
      body: "Created from the dev page.",
      url: `https://tracker.example.com/issue/${key}`,
      labels: [],
      project: { id: project.id, name: project.name },
      state: todo,
      updatedAt: this.now(),
    };
    target.tracker.addTicket(ticket);
    return ticket;
  }

  /** 일하는 런 하나가 질문한다. 질문한 런의 워크트리 이름을 돌려준다 */
  askQuestion(): string | null {
    for (const runner of this.world.runners.values()) {
      if (!runner.online) continue;
      for (const run of runner.runs.values()) {
        if (run.report !== null || run.endedWithoutReport !== null || run.agentStopped) continue;
        const open = run.questions.some((q) => !run.answers.some((a) => a.questionId === q.id));
        if (open || run.permissionWaits.length > 0) continue;
        const question = QUESTIONS[run.questions.length % QUESTIONS.length];
        if (question === undefined) return null;
        runner.ask(run.started.worktree, question);
        return run.input.worktreeName;
      }
    }
    return null;
  }

  /**
   * GitHub 인증이 깨진 러너를 고치거나, 고친 러너를 다시 깨뜨린다. 러너 확인을 요청해 worker 가 곧 다시 본다.
   * 바꾼 뒤 인증이 멀쩡한지 돌려준다. 그런 러너가 없으면 null 이다.
   */
  togglePushAuth(): boolean | null {
    for (const stored of listRunners(this.db)) {
      const sshTarget = stringAt(stored.config, "sshTarget");
      if (!sshTarget.includes(FAIL_PUSH_AUTH)) continue;
      const runner = this.world.runner(sshTarget);
      const healthy = runner.prerequisites.some(
        (p) => p.id.startsWith("github-push:") && p.satisfied === false,
      );
      runner.prerequisites = runner.prerequisites.map((p) =>
        p.id.startsWith("github-push:") ? { ...p, satisfied: healthy } : p,
      );
      requestRunnerCheck(this.db, stored.id, this.now());
      return healthy;
    }
    return null;
  }

  private trackerConnections(): Array<{ connection: TrackerConnectionId; tracker: FakeTracker }> {
    return listTrackerConnections(this.db, this.secretBox).map((stored) => ({
      connection: stored.id,
      tracker: this.world.tracker(stringAt(stored.secrets, "apiKey")),
    }));
  }
}

function branchOf(world: DemoWorld, worktree: WorktreeRef): string {
  for (const runner of world.runners.values()) {
    for (const run of runner.runs.values()) {
      if (run.started.worktree === worktree) return run.started.branch;
    }
  }
  return "";
}

/** 워크트리 이름(factory-ACME-1-1)에서 티켓 키를 꺼낸다 */
function ticketKeyOf(worktreeName: string): string {
  return worktreeName.replace(/^factory-/, "").replace(/-\d+$/, "");
}

/** 워크트리 이름마다 정해진 계획. 다시 띄워도 같은 런은 같게 움직인다 */
export function planFor(worktreeName: string): Plan {
  const h = hash(worktreeName);
  const roll = h % 100;
  return {
    workMs: WORK_MS.min + (h % (WORK_MS.max - WORK_MS.min)),
    ask: (h >> 3) % 3 === 0,
    outcome: roll < 60 ? "merged" : roll < 80 ? "open" : roll < 92 ? "failure" : "vanish",
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
