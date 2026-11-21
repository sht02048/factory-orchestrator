import { describe, expect, it } from "vitest";

import { isAssignmentBlocked } from "./adapters.js";
import type { CodeHost, Runner } from "./adapters.js";
import { checkAutoAssignment } from "./assignment.js";
import type { RunnerSnapshot } from "./assignment.js";
import {
  toAgentId,
  toCodeHostKind,
  toLabelId,
  toPullRequestId,
  toRunId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTicketKey,
  toTrackerConnectionId,
  toTrackerKind,
  toTrackerProjectId,
  toTrackerStateId,
} from "./ids.js";
import type { RunnerId, RunnerProjectId } from "./ids.js";
import { decidePrState } from "./pr-state.js";
import { planQueue } from "./queue.js";
import { AdapterRegistry, UnknownAdapterKindError } from "./registry.js";
import { summarizeRunOutcome } from "./summary.js";
import { fakeCodeHostFactory, fakeRunnerFactory, fakeTrackerFactory } from "./testing/index.js";
import { resolveRunProgress } from "./timing.js";

describe("AdapterRegistry", () => {
  it("같은 종류를 두 번 등록하면 거부한다", () => {
    const registry = new AdapterRegistry().registerRunner(fakeRunnerFactory().factory);

    expect(() => registry.registerRunner(fakeRunnerFactory().factory)).toThrow("두 번 등록했다");
  });

  it("등록하지 않은 종류로 만들면 UnknownAdapterKindError다", () => {
    const registry = new AdapterRegistry();

    expect(() => registry.createTracker(toTrackerKind("nope"), {})).toThrow(
      UnknownAdapterKindError,
    );
  });

  it("등록한 종류를 알려 준다", () => {
    const registry = new AdapterRegistry()
      .registerTracker(fakeTrackerFactory(toTrackerKind("tracker-a")).factory)
      .registerTracker(fakeTrackerFactory(toTrackerKind("tracker-b")).factory);

    expect(registry.kinds().trackers).toEqual(["tracker-a", "tracker-b"]);
    expect(registry.createTracker(toTrackerKind("tracker-b"), {}).kind).toBe("tracker-b");
  });
});

describe("확장 전제: 종류가 다른 어댑터를 함께 등록해도 core 규칙은 그대로다", () => {
  it("트래커 두 종류에서 같은 키의 티켓을 연결별로 가르고 자동 할당 조건이 같은 규칙으로 돈다", async () => {
    const trackersA = fakeTrackerFactory(toTrackerKind("tracker-a"));
    const trackersB = fakeTrackerFactory(toTrackerKind("tracker-b"));
    const registry = new AdapterRegistry()
      .registerTracker(trackersA.factory)
      .registerTracker(trackersB.factory);

    const connections = [
      { id: toTrackerConnectionId("conn-a"), kind: toTrackerKind("tracker-a") },
      { id: toTrackerConnectionId("conn-b"), kind: toTrackerKind("tracker-b") },
    ];
    const auto = toLabelId("auto");
    const key = toTicketKey("ENG-1");
    for (const connection of connections) {
      registry.createTracker(connection.kind, { apiKey: "adapter-only" });
    }
    for (const fake of [...trackersA.created, ...trackersB.created]) {
      fake.addTicket({
        key,
        title: "같은 키",
        body: "",
        url: "https://example.com/ENG-1",
        labels: [{ id: auto, name: "auto" }],
        project: { id: toTrackerProjectId("p"), name: "p" },
        state: { id: toTrackerStateId("s"), name: "Todo", category: "unstarted" },
        updatedAt: new Date(1),
      });
    }

    const runs = [
      {
        ticket: { connection: connections[0]!.id, key },
        state: "running" as const,
        assignedAt: new Date(1),
        agentResult: null,
        endedAt: null,
      },
    ];
    const trackers = [trackersA.created[0]!, trackersB.created[0]!];
    const results = [];
    for (const [index, tracker] of trackers.entries()) {
      const [ticket] = await tracker.listLabeledTickets({
        labelId: auto,
        updatedSince: new Date(0),
      });
      results.push(
        checkAutoAssignment({
          labelIds: ticket!.labels.map((label) => label.id),
          autoAssignLabelId: auto,
          labelAttachedAt: null,
          ticket: { connection: connections[index]!.id, key: ticket!.key },
          runs,
        }),
      );
    }

    expect(results).toEqual([{ ok: false, reason: "active-run" }, { ok: true }]);
  });

  it("러너·코드 호스트 두 종류에서 대기열·다시 연결·PR 상태·요약 계산이 같은 규칙으로 돈다", async () => {
    const runnersA = fakeRunnerFactory(toRunnerKind("runner-a"));
    const runnersB = fakeRunnerFactory(toRunnerKind("runner-b"));
    const hostsA = fakeCodeHostFactory(toCodeHostKind("host-a"), "a:");
    const hostsB = fakeCodeHostFactory(toCodeHostKind("host-b"), "b:");
    const registry = new AdapterRegistry()
      .registerTracker(fakeTrackerFactory(toTrackerKind("tracker-a")).factory)
      .registerTracker(fakeTrackerFactory(toTrackerKind("tracker-b")).factory)
      .registerRunner(runnersA.factory)
      .registerRunner(runnersB.factory)
      .registerCodeHost(hostsA.factory)
      .registerCodeHost(hostsB.factory);

    const registered: Array<{ id: RunnerId; kind: string; project: RunnerProjectId }> = [
      { id: toRunnerId("r-a"), kind: "runner-a", project: toRunnerProjectId("a:acme/app") },
      { id: toRunnerId("r-b"), kind: "runner-b", project: toRunnerProjectId("b:acme/web") },
    ];
    const runners = new Map<RunnerId, Runner>();
    for (const r of registered) {
      const runner = registry.createRunner(toRunnerKind(r.kind), { anything: "adapter-only" });
      runners.set(r.id, runner);
    }
    runnersA.created[0]?.setProjects([
      { id: registered[0]!.project, displayName: "app", setupState: "ready" },
    ]);
    runnersB.created[0]?.setProjects([
      { id: registered[1]!.project, displayName: "web", setupState: "ready" },
    ]);

    const snapshots: RunnerSnapshot[] = [];
    for (const [id, runner] of runners) {
      const health = await runner.checkHealth();
      const projects = await runner.listProjects();
      snapshots.push({
        id,
        online: health.online,
        assignmentBlocked: isAssignmentBlocked(health),
        capacity: 1,
        projects: projects.map((p) => p.id),
        usageLimits: [],
      });
    }
    const plan = planQueue({
      queued: [
        {
          id: toRunId("run-a"),
          assignedAt: new Date(1),
          project: registered[0]!.project,
          agent: toAgentId("agent"),
          runnerId: null,
          unstartable: false,
        },
        {
          id: toRunId("run-b"),
          assignedAt: new Date(2),
          project: registered[1]!.project,
          agent: toAgentId("agent"),
          runnerId: null,
          unstartable: false,
        },
      ],
      runners: snapshots,
      runs: [],
    });
    expect(plan.start).toEqual([
      { runId: "run-a", runnerId: "r-a" },
      { runId: "run-b", runnerId: "r-b" },
    ]);

    const codeHosts: CodeHost[] = [
      registry.createCodeHost(toCodeHostKind("host-a"), {}),
      registry.createCodeHost(toCodeHostKind("host-b"), {}),
    ];
    const runStartedAt = new Date("2026-01-01T00:00:00Z");
    const outcomes = [];
    for (const [index, start] of plan.start.entries()) {
      const runner = runners.get(start.runnerId)!;
      const project = registered[index]!.project;
      const mailbox = await runner.ensureMailbox(null);
      const started = await runner.startRun({
        mailbox,
        project,
        worktreeName: `ganger-ENG-${index}-1`,
        agent: toAgentId("agent"),
        brief: "티켓",
      });
      const branch = started.branch;
      const fake = (index === 0 ? runnersA : runnersB).created[0]!;
      fake.report(started.worktree, { outcome: index === 0 ? "succeeded" : "failed" });

      const codeHost = codeHosts.find((host) => host.repoOf(project) !== null)!;
      const repo = codeHost.repoOf(project)!;
      (index === 0 ? hostsA : hostsB).created[0]!.putPullRequest(repo, {
        id: toPullRequestId(`pr-${index}`),
        displayId: "#1",
        url: "https://example.com/pr/1",
        title: `ENG-${index}`,
        body: "",
        state: index === 0 ? "merged" : "open",
        createdAt: new Date("2026-01-01T01:00:00Z"),
        mergedAt: null,
        headBranch: branch,
        sourceRepo: repo,
        headCommit: "abc",
        baseBranch: "main",
        ci: "none",
      });

      const progress = await runner.pollRun({ mailbox, ...started });
      const resolution = resolveRunProgress(progress, { answered: new Set(), denied: new Set() });
      if (resolution.kind !== "end") throw new Error("런이 끝나야 한다");
      const ticketKey = toTicketKey(`ENG-${index}`);
      const { prState } = decidePrState({
        repo,
        ticketKey,
        runStartedAt,
        byBranch: await codeHost.findPullRequestsByBranch(repo, branch),
        byTicketKey: await codeHost.findPullRequestsByTicketKey(repo, ticketKey, {
          createdSince: runStartedAt,
        }),
      });
      outcomes.push(
        summarizeRunOutcome({
          agentResult: resolution.agentResult,
          prState,
          runnerUnreached: false,
        }),
      );
    }

    expect(outcomes).toEqual([
      { outcome: "succeeded", worktree: "remove-now" },
      { outcome: "failed", worktree: "keep-until-pr-settles" },
    ]);
  });
});
