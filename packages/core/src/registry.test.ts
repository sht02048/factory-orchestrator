import { describe, expect, it } from "vitest";

import type { CodeHost, Runner } from "./adapters.js";
import type { RunnerSnapshot } from "./assignment.js";
import {
  toCodeHostKind,
  toRunId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTicketKey,
  toTrackerKind,
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
  it("러너·코드 호스트 두 종류에서 대기열·다시 연결·PR 상태·요약 계산이 같은 규칙으로 돈다", async () => {
    // 새 종류는 core를 고치지 않고 factory를 한 줄씩 등록해 더한다.
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

    // DB에 저장된 러너 설정이라고 본다: 종류와 그 종류만 아는 설정.
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

    // 어댑터가 답한 상태로 core 대기열 입력을 만든다.
    const snapshots: RunnerSnapshot[] = [];
    for (const [id, runner] of runners) {
      const health = await runner.checkHealth();
      const projects = await runner.listProjects();
      snapshots.push({
        id,
        online: health.online,
        capacity: 1,
        projects: projects.map((p) => p.id),
      });
    }
    const plan = planQueue({
      queued: [
        {
          id: toRunId("run-a"),
          assignedAt: new Date(1),
          project: registered[0]!.project,
          runnerId: null,
        },
        {
          id: toRunId("run-b"),
          assignedAt: new Date(2),
          project: registered[1]!.project,
          runnerId: null,
        },
      ],
      runners: snapshots,
      runs: [],
    });
    expect(plan.start).toEqual([
      { runId: "run-a", runnerId: "r-a" },
      { runId: "run-b", runnerId: "r-b" },
    ]);

    // 각 러너 종류로 시작하고 끝을 읽어 core가 두 축과 요약 결과를 정한다.
    const codeHosts: CodeHost[] = [
      registry.createCodeHost(toCodeHostKind("host-a"), {}),
      registry.createCodeHost(toCodeHostKind("host-b"), {}),
    ];
    const runStartedAt = new Date("2026-01-01T00:00:00Z");
    const outcomes = [];
    for (const [index, start] of plan.start.entries()) {
      const runner = runners.get(start.runnerId)!;
      const project = registered[index]!.project;
      const branch = `factory/ENG-${index}-1`;
      const started = await runner.startRun({
        project,
        worktreeName: `ENG-${index}`,
        branch,
        agent: "agent",
        prompt: "티켓",
      });
      const fake = (index === 0 ? runnersA : runnersB).created[0]!;
      fake.setProgress(started.worktree, { kind: "finished", exitCode: index });

      const codeHost = codeHosts.find((host) => host.repoOf(project) !== null)!;
      const repo = codeHost.repoOf(project)!;
      (index === 0 ? hostsA : hostsB).created[0]!.putPullRequest(repo, {
        number: 1,
        url: "https://example.com/pr/1",
        title: `ENG-${index}`,
        body: "",
        state: index === 0 ? "merged" : "open",
        createdAt: new Date("2026-01-01T01:00:00Z"),
        mergedAt: null,
        headRefName: branch,
        headRepository: repo,
        headSha: "abc",
        baseRefName: "main",
        ci: "none",
      });

      const resolution = resolveRunProgress(await runner.pollRun(started.worktree));
      if (resolution.kind !== "end") throw new Error("런이 끝나야 한다");
      const { prState } = decidePrState({
        repo,
        runStartedAt,
        byBranch: await codeHost.findPullRequestsByBranch(repo, branch),
        byTicketKey: await codeHost.findPullRequestsByTicketKey(repo, toTicketKey(`ENG-${index}`)),
      });
      outcomes.push(summarizeRunOutcome(resolution.agentResult, prState));
    }

    expect(outcomes).toEqual([
      { outcome: "merged", worktree: "remove-now" },
      { outcome: "human-check", worktree: "keep-until-pr-settles" },
    ]);
  });
});
