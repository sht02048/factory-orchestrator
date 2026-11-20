import { randomUUID } from "node:crypto";
import { toDeliveryId, toPullRequestId, toRepoRef, toTicketKey } from "@ganger/core";
import type {
  RunnerProjectId,
  TicketKey,
  TrackerConnectionId,
  TrackerTicket,
  WorktreeRef,
} from "@ganger/core";
import type { FakeRunner, FakeRunnerRun, FakeTracker } from "@ganger/core/testing";
import {
  listRunners,
  listRuns,
  listTrackerConnections,
  recordTrackerEvent,
  requestRunnerCheck,
} from "@ganger/db";
import type { Database, SecretBox } from "@ganger/db";
import { autoAssignLabel } from "./fixtures.js";
import { FAIL_PUSH_AUTH } from "./values.js";
import { pullRequestOf } from "./hydrate.js";
import { stringAt } from "./world.js";
import type { DemoWorld } from "./world.js";

const WORK_MS = { min: 40_000, max: 110_000 };
const MERGE_AFTER_MS = 90_000;
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
  outcome: "merged" | "open" | "failure" | "vanish";
}

interface Tracked {
  plan: Plan;
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
  private readonly toMerge: Array<{ repo: RunnerProjectId; worktree: WorktreeRef; at: number }> =
    [];
  private lastTick: number | null = null;
  private lastNewWork = 0;
  private ticketSeq = 1000;
  private prSeq = 2000;

  constructor(options: LifeOptions) {
    this.db = options.db;
    this.secretBox = options.secretBox;
    this.world = options.world;
    this.now = options.now ?? (() => new Date());
  }

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
        states: ["queued", "running", "waiting-for-input", "paused"],
      }).length;
      if (active < BUSY_RUNS) this.labelTicket();
    }
  }

  private step(runner: FakeRunner, run: FakeRunnerRun, elapsed: number): void {
    if (run.report !== null || run.endedWithoutReport !== null || run.agentStopped) return;
    if (run.paused) return;
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
      this.prSeq += 1;
      const number = this.prSeq;
      const key = ticketKeyOf(run.input.worktreeName);
      const pr = pullRequestOf(
        {
          headCommit: `demo-${hash(run.input.worktreeName).toString(16)}`,
          ticketKey: key,
          runnerProject: repo,
          startedAt: new Date(this.now().getTime() - 5 * 60_000),
          branch: run.started.branch,
        },
        {
          id: toPullRequestId(`pr-${randomUUID()}`),
          displayId: `#${number}`,
          url: `https://code.example.com/${repo}/pull/${number}`,
        },
      );
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
        })
        .catch((error: unknown) =>
          console.warn("[dev] could not merge a fake pull request", error),
        );
    }
  }

  labelTicket(): TicketKey | null {
    const target = this.trackerConnections()[0];
    if (target === undefined) return null;
    const busy = new Set(
      listRuns(this.db, {
        states: ["queued", "running", "waiting-for-input", "paused", "disconnected"],
      }).map((run) => run.ticket.key),
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

function ticketKeyOf(worktreeName: string): TicketKey {
  return toTicketKey(worktreeName.replace(/^ganger-/, "").replace(/-\d+$/, ""));
}

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
