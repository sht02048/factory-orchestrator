import { summarizeRunOutcome } from "@factory/core";
import type { PrState, RetryToken, WorktreeRef } from "@factory/core";
import { getRun, getRunWithRecords } from "@factory/db";
import type { StoredRun } from "@factory/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Harness,
  outcomeUnknownAfterStart,
  projectA,
  projectB,
  projectC,
  recordingStarts,
} from "./test-fixtures.js";
import { startWorker } from "./worker.js";

let h: Harness;

beforeEach(() => {
  h = new Harness();
});

afterEach(async () => {
  await h.cleanup();
});

function current(run: StoredRun): StoredRun {
  const found = getRun(h.db, run.id);
  if (found === null) throw new Error(`run ${run.id} is gone`);
  return found;
}

function stateOf(run: StoredRun): string {
  return current(run).state;
}

function worktreeOf(run: StoredRun): WorktreeRef {
  const found = current(run);
  if (found.state === "queued") throw new Error(`run ${run.id} has not started`);
  return found.worktree;
}

function finish(run: StoredRun, exitCode: number): void {
  const found = current(run);
  if (found.state === "queued") throw new Error(`run ${run.id} has not started`);
  h.runner(found.runnerId).setProgress(found.worktree, { kind: "finished", exitCode });
}

describe("대기열과 capacity", () => {
  it("런 셋을 할당하면 capacity만큼 시작하고 나머지는 Queued로 남았다가 차례로 시작한다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 2, projects: [projectA] });
    const first = h.assign("ENG-1", projectA);
    const second = h.assign("ENG-2", projectA);
    const third = h.assign("ENG-3", projectA);
    const worker = h.worker();

    await worker.tick();
    expect([stateOf(first), stateOf(second), stateOf(third)]).toEqual([
      "running",
      "running",
      "queued",
    ]);
    expect(h.runner(runnerA).worktrees.size).toBe(2);

    // 다음 바퀴에도 capacity가 차 있으면 시작하지 않는다.
    await worker.tick();
    expect(stateOf(third)).toBe("queued");

    finish(first, 0);
    await worker.tick();
    expect([stateOf(first), stateOf(second), stateOf(third)]).toEqual([
      "ended",
      "running",
      "running",
    ]);
    expect(h.runner(runnerA).worktrees.size).toBe(3);
  });
});

describe("두 축 기록", () => {
  const cases: Array<{
    exitCode: number;
    pr: PrState;
    agentResult: string;
    outcome: string;
  }> = [
    { exitCode: 0, pr: "merged", agentResult: "exited-normally", outcome: "merged" },
    { exitCode: 1, pr: "merged", agentResult: "exited-with-error", outcome: "merged" },
    { exitCode: 0, pr: "open", agentResult: "exited-normally", outcome: "human-check" },
    { exitCode: 1, pr: "open", agentResult: "exited-with-error", outcome: "human-check" },
    { exitCode: 0, pr: "closed", agentResult: "exited-normally", outcome: "failed" },
    { exitCode: 0, pr: "none", agentResult: "exited-normally", outcome: "failed" },
    { exitCode: 2, pr: "none", agentResult: "exited-with-error", outcome: "failed" },
  ];

  it.each(cases)(
    "종료 코드 $exitCode, PR $pr → 에이전트 결과 $agentResult, 요약 $outcome",
    async ({ exitCode, pr, agentResult, outcome }) => {
      h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
      const run = h.assign("ENG-1", projectA);
      const worker = h.worker();
      await worker.tick();
      expect(stateOf(run)).toBe("running");

      h.advance(60_000);
      if (pr !== "none") h.putPullRequest(current(run), pr);
      finish(run, exitCode);
      await worker.tick();

      const found = getRunWithRecords(h.db, run.id);
      if (found?.run.state !== "ended") throw new Error("run did not end");
      expect(found.run.agentResult).toBe(agentResult);
      expect(found.run.prState).toBe(pr);
      expect(found.run.endedAt).toEqual(h.now);
      expect(summarizeRunOutcome(found.run.agentResult, found.run.prState).outcome).toBe(outcome);
      expect(found.records.pullRequest === null).toBe(pr === "none");
    },
  );

  it("코드 호스트 어댑터를 만들지 못하면 PR 상태를 없음으로 확정하지 않고 다음 바퀴에 다시 본다", async () => {
    h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    const worker = h.worker();
    await worker.tick();
    h.putPullRequest(current(run), "open");
    finish(run, 0);

    h.codeHostBroken = true;
    await worker.tick();
    expect(stateOf(run)).toBe("running");

    h.codeHostBroken = false;
    await worker.tick();
    const ended = current(run);
    expect(ended.state === "ended" && ended.prState).toBe("open");
  });

  it("코드 호스트가 실패하면 끝내지 않고 다음 바퀴에 다시 기록한다", async () => {
    h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    const worker = h.worker();
    await worker.tick();
    h.putPullRequest(current(run), "open");
    finish(run, 0);

    const spy = vi
      .spyOn(h.codeHost, "findPullRequestsByBranch")
      .mockRejectedValueOnce(new Error("network"));
    await worker.tick();
    expect(stateOf(run)).toBe("running");

    await worker.tick();
    spy.mockRestore();
    const ended = current(run);
    expect(ended.state === "ended" && ended.prState).toBe("open");
  });
});

describe("엄격한 FIFO", () => {
  it("맨 앞 런의 러너가 꽉 차 있으면 다른 러너의 뒤 런도 시작하지 않는다(Q63 개정)", async () => {
    const runnerB = h.addRunner({ id: "runner-b", capacity: 1, projects: [projectB] });
    h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const busy = h.assign("ENG-1", projectA);
    const worker = h.worker();
    await worker.tick();
    expect(stateOf(busy)).toBe("running");

    const head = h.assign("ENG-2", projectA);
    const behind = h.assign("ENG-3", projectB);
    await worker.tick();
    expect([stateOf(head), stateOf(behind)]).toEqual(["queued", "queued"]);
    expect(h.runner(runnerB).worktrees.size).toBe(0);

    finish(busy, 0);
    await worker.tick();
    expect([stateOf(busy), stateOf(head), stateOf(behind)]).toEqual([
      "ended",
      "running",
      "running",
    ]);
  });

  it("러너 없는 Queued 런은 뒤 런을 막지 않고, 맞는 러너가 Online이 되면 시작한다(Q65·Q68·Q73)", async () => {
    const runnerC = h.addRunner({
      id: "runner-c",
      capacity: 1,
      online: false,
      projects: [projectC],
    });
    h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const orphan = h.assign("ENG-1", projectC);
    const behind = h.assign("ENG-2", projectA);
    expect(current(orphan)).toMatchObject({ state: "queued", runnerId: null });

    const worker = h.worker();
    await worker.tick();
    expect([stateOf(orphan), stateOf(behind)]).toEqual(["queued", "running"]);

    h.setRunnerOnline(runnerC, true);
    await worker.tick();
    expect(current(orphan)).toMatchObject({ state: "running", runnerId: runnerC });
  });

  it("정한 러너가 Offline이 된 Queued 런은 러너를 비우고 뒤 런을 막지 않는다(Q72)", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    h.addRunner({ id: "runner-b", capacity: 1, projects: [projectB] });
    const busy = h.assign("ENG-1", projectA);
    const worker = h.worker();
    await worker.tick();

    const waiting = h.assign("ENG-2", projectA);
    const behind = h.assign("ENG-3", projectB);
    expect(current(waiting)).toMatchObject({ state: "queued", runnerId: runnerA });

    h.setRunnerOnline(runnerA, false);
    await worker.tick();
    expect(current(waiting)).toMatchObject({ state: "queued", runnerId: null });
    expect(stateOf(behind)).toBe("running");
    // 닿지 않는 러너의 런은 그대로 둔다(연결 끊김 처리는 0016).
    expect(stateOf(busy)).toBe("running");
  });
});

describe("재시작 안전", () => {
  it("런 시작 직후 데몬을 멈췄다 다시 띄워도 런이 하나만 시작된다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 2, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);

    const first = h.worker();
    await first.tick();
    await first.close();
    const worktree = worktreeOf(run);

    const second = h.worker();
    await second.tick();
    await second.tick();
    expect(stateOf(run)).toBe("running");
    expect(worktreeOf(run)).toBe(worktree);
    expect(h.runner(runnerA).worktrees.size).toBe(1);
  });

  it("러너가 시작 결과를 모른다고 답하면 데몬을 다시 띄운 뒤 러너가 준 값으로 같은 시작을 다시 보낸다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 2, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    const sent: Array<RetryToken | undefined> = [];

    h.wrapRunner = (fake) => outcomeUnknownAfterStart(fake, sent);
    const first = h.worker();
    await first.tick();
    await first.close();
    expect(stateOf(run)).toBe("queued");
    expect(h.runner(runnerA).worktrees.size).toBe(1);
    const [startedWorktree] = h.runner(runnerA).worktrees.keys();
    const saved = getRunWithRecords(h.db, run.id)?.records.retryToken ?? null;
    expect(saved).not.toBeNull();

    h.wrapRunner = (fake) => recordingStarts(fake, sent);
    const second = h.worker();
    await second.tick();
    expect(stateOf(run)).toBe("running");
    expect(worktreeOf(run)).toBe(startedWorktree);
    expect(h.runner(runnerA).worktrees.size).toBe(1);
    // 첫 시작에는 다시 보내기 값을 보내지 않고, 다시 보낼 때만 러너가 준 값을 보낸다.
    expect(sent).toEqual([undefined, saved]);
  });
});

describe("결과를 모르는 시작", () => {
  it("러너가 Offline이 되어도 다른 러너에서 다시 시작하지 않고, 돌아오면 그 러너에 다시 보낸다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const runnerB = h.addRunner({ id: "runner-b", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    expect(current(run)).toMatchObject({ runnerId: runnerA });
    const sent: Array<RetryToken | undefined> = [];

    h.wrapRunner = (fake) => outcomeUnknownAfterStart(fake, sent);
    const first = h.worker();
    await first.tick();
    await first.close();
    const [startedWorktree] = h.runner(runnerA).worktrees.keys();

    h.wrapRunner = (fake) => recordingStarts(fake, sent);
    h.setRunnerOnline(runnerA, false);
    const second = h.worker();
    await second.tick();
    expect(current(run)).toMatchObject({ state: "queued", runnerId: runnerA });
    expect(h.runner(runnerB).worktrees.size).toBe(0);

    h.setRunnerOnline(runnerA, true);
    await second.tick();
    expect(current(run)).toMatchObject({ state: "running", runnerId: runnerA });
    expect(worktreeOf(run)).toBe(startedWorktree);
    expect(h.runner(runnerA).worktrees.size).toBe(1);
    expect(sent).toHaveLength(2);
  });

  it("묶인 런은 맞는 다른 러너의 capacity를 차지하지 않고 뒤 런을 막지 않는다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    h.addRunner({ id: "runner-b", capacity: 1, projects: [projectA, projectB] });
    const bound = h.assign("ENG-1", projectA);
    const behind = h.assign("ENG-2", projectB);

    h.wrapRunner = (fake) => outcomeUnknownAfterStart(fake, []);
    const first = h.worker();
    await first.tick();
    await first.close();

    h.wrapRunner = (fake) => fake;
    h.setRunnerOnline(runnerA, false);
    await h.worker().tick();
    expect([stateOf(bound), stateOf(behind)]).toEqual(["queued", "running"]);
  });
});

describe("startWorker", () => {
  it("멈출 때까지 tick을 이어서 돈다", async () => {
    h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    const worker = startWorker({
      dbPath: h.dbPath,
      registry: h.registry,
      secretBox: h.secretBox,
      now: () => h.now,
      pollIntervalMs: 5,
      logger: { warn: () => undefined },
    });
    try {
      await vi.waitFor(() => expect(stateOf(run)).toBe("running"));
      finish(run, 0);
      await vi.waitFor(() => expect(stateOf(run)).toBe("ended"));
    } finally {
      await worker.stop();
    }
  });
});
