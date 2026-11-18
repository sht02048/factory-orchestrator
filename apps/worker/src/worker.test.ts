import { AdapterError, MAX_START_RETRIES, summarizeRunOutcome } from "@ganger/core";
import type { CompletionReport, PrState, WorktreeRef } from "@ganger/core";
import { getRun, getRunWithRecords } from "@ganger/db";
import type { StoredRun } from "@ganger/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Harness, projectA, projectB, projectC } from "./test-fixtures.js";
import { START_UNREACHABLE_RETRY_MS, startWorker } from "./worker.js";

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
  if (found.state === "queued" || found.worktree === null) {
    throw new Error(`run ${run.id} has not started`);
  }
  return found.worktree;
}

function finish(run: StoredRun, outcome: CompletionReport["outcome"] = "succeeded"): void {
  const found = current(run);
  if (found.state === "queued" || found.runnerId === null || found.worktree === null) {
    throw new Error(`run ${run.id} has not started`);
  }
  h.runner(found.runnerId).report(found.worktree, { outcome, body: `보고: ${outcome}` });
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
    expect(h.runner(runnerA).runs.size).toBe(2);

    await worker.tick();
    expect(stateOf(third)).toBe("queued");

    finish(first);
    await worker.tick();
    expect([stateOf(first), stateOf(second), stateOf(third)]).toEqual([
      "ended",
      "running",
      "running",
    ]);
    expect(h.runner(runnerA).startCalls).toHaveLength(3);
    expect(h.runner(runnerA).runs.size).toBe(2);
  });
});

describe("두 축 기록", () => {
  const cases: Array<{
    report: "succeeded" | "failed";
    pr: PrState;
    agentResult: string;
    outcome: string;
  }> = [
    { report: "succeeded", pr: "merged", agentResult: "reported-success", outcome: "merged" },
    { report: "failed", pr: "merged", agentResult: "reported-failure", outcome: "merged" },
    { report: "succeeded", pr: "open", agentResult: "reported-success", outcome: "human-check" },
    { report: "failed", pr: "open", agentResult: "reported-failure", outcome: "human-check" },
    { report: "succeeded", pr: "closed", agentResult: "reported-success", outcome: "failed" },
    { report: "succeeded", pr: "none", agentResult: "reported-success", outcome: "failed" },
    { report: "failed", pr: "none", agentResult: "reported-failure", outcome: "failed" },
  ];

  it.each(cases)(
    "완료 보고 $report, PR $pr → 에이전트 결과 $agentResult, 요약 $outcome",
    async ({ report, pr, agentResult, outcome }) => {
      h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
      const run = h.assign("ENG-1", projectA);
      const worker = h.worker();
      await worker.tick();
      expect(stateOf(run)).toBe("running");

      h.advance(60_000);
      if (pr !== "none") h.putPullRequest(current(run), pr);
      finish(run, report);
      await worker.tick();

      const found = getRunWithRecords(h.db, run.id);
      if (found?.run.state !== "ended") throw new Error("run did not end");
      expect(found.run.agentResult).toBe(agentResult);
      expect(found.run.prState).toBe(pr);
      expect(found.run.endedAt).toEqual(h.now);
      expect(summarizeRunOutcome(found.run).outcome).toBe(outcome);
      expect(found.records.pullRequest === null).toBe(pr === "none");
      expect(found.records.reportBody).toBe(`보고: ${report}`);
    },
  );

  it("코드 호스트 어댑터를 만들지 못하면 PR 상태를 없음으로 확정하지 않고 다음 바퀴에 다시 본다", async () => {
    h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    const worker = h.worker();
    h.codeHostBroken = true;
    await worker.tick();
    h.putPullRequest(current(run), "open");
    finish(run);

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
    finish(run);

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
    expect(h.runner(runnerB).runs.size).toBe(0);

    finish(busy);
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
    expect(stateOf(busy)).toBe("running");
  });
});

describe("시작 멱등과 실제 브랜치 (Q82.6)", () => {
  it("결정적 워크트리 이름으로 시작하고 러너에서 받은 실제 브랜치를 저장한다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    await h.worker().tick();

    expect(h.runner(runnerA).startCalls.map((call) => call.worktreeName)).toEqual([
      "ganger-ENG-1-1",
    ]);
    expect(current(run)).toMatchObject({ state: "running", branch: "fake/ganger-ENG-1-1" });
  });

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
    expect(h.runner(runnerA).runs.size).toBe(1);
  });

  it("러너가 응답한 뒤 Running을 쓰기 전에 데몬이 죽으면, 다시 띄웠을 때 같은 이름으로 이미 시작한 런을 찾아 이어 붙인다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 2, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);

    h.runner(runnerA).loseNextStartResponse = true;
    const first = h.worker();
    await first.tick();
    await first.close();
    expect(stateOf(run)).toBe("queued");
    expect(getRunWithRecords(h.db, run.id)?.records.startRequestedAt).not.toBeNull();
    const startedWorktree = h.runner(runnerA).runs.get("ganger-ENG-1-1")?.started.worktree;

    const second = h.worker();
    await second.tick();
    expect(stateOf(run)).toBe("running");
    expect(worktreeOf(run)).toBe(startedWorktree);
    expect(h.runner(runnerA).runs.size).toBe(1);
    expect(h.runner(runnerA).startCalls).toHaveLength(1);
  });

  it("시작을 보냈는데 러너에 그 이름의 런이 없으면 같은 이름으로 다시 보낸다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    h.runner(runnerA).failNextStart = { kind: "start-outcome-unknown", detail: "lost" };
    const worker = h.worker();

    await worker.tick();
    expect(stateOf(run)).toBe("queued");
    await worker.tick();
    expect(stateOf(run)).toBe("running");
    expect(h.runner(runnerA).startCalls.map((call) => call.worktreeName)).toEqual([
      "ganger-ENG-1-1",
      "ganger-ENG-1-1",
    ]);
  });

  it("시작을 보낸 런은 러너가 Offline이 되어도 다른 러너에서 다시 시작하지 않고, 돌아오면 이어 붙인다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const runnerB = h.addRunner({ id: "runner-b", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    expect(current(run)).toMatchObject({ runnerId: runnerA });

    h.runner(runnerA).loseNextStartResponse = true;
    const first = h.worker();
    await first.tick();
    await first.close();

    h.setRunnerOnline(runnerA, false);
    const second = h.worker();
    await second.tick();
    expect(current(run)).toMatchObject({ state: "queued", runnerId: runnerA });
    expect(h.runner(runnerB).runs.size).toBe(0);

    h.setRunnerOnline(runnerA, true);
    await second.tick();
    expect(current(run)).toMatchObject({ state: "running", runnerId: runnerA });
    expect(h.runner(runnerA).startCalls).toHaveLength(1);
  });

  it("묶인 런은 맞는 다른 러너의 capacity를 차지하지 않고 뒤 런을 막지 않는다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    h.addRunner({ id: "runner-b", capacity: 1, projects: [projectA, projectB] });
    const bound = h.assign("ENG-1", projectA);
    const behind = h.assign("ENG-2", projectB);

    h.runner(runnerA).loseNextStartResponse = true;
    const first = h.worker();
    await first.tick();
    await first.close();

    h.setRunnerOnline(runnerA, false);
    await h.worker().tick();
    expect([stateOf(bound), stateOf(behind)]).toEqual(["queued", "running"]);
  });

  it("우편함이 사라졌으면 다시 만들고 저장한다 (Q82.1)", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 2, projects: [projectA] });
    const first = h.assign("ENG-1", projectA);
    const worker = h.worker();
    await worker.tick();
    const mailboxOf = () =>
      h.db.$client.prepare("SELECT mailbox_ref AS m FROM runners WHERE id = ?").get(runnerA)?.["m"];
    const before = mailboxOf();
    expect(before).toBeTruthy();
    expect(h.runner(runnerA).startCalls[0]?.mailbox).toBe(before);

    h.runner(runnerA).dropMailbox(h.runner(runnerA).startCalls[0]!.mailbox);
    const second = h.assign("ENG-2", projectA);
    await worker.tick();
    expect(stateOf(second)).toBe("running");
    expect(mailboxOf()).not.toBe(before);
    expect(stateOf(first)).toBe("running");
  });
});

describe("시작 실패와 시작할 수 없음 (Q82.16·Q86)", () => {
  it("러너가 시작 명령에 오류를 내면 같은 이름으로 3번까지 다시 시도하고, 그래도 안 되면 시작할 수 없음으로 끝내 뒤 런을 막지 않는다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 2, projects: [projectA] });
    const head = h.assign("ENG-1", projectA);
    const behind = h.assign("ENG-2", projectA);
    const fake = h.runner(runnerA);
    const worker = h.worker();

    const behindStates: string[] = [];
    for (let attempt = 0; attempt <= MAX_START_RETRIES; attempt += 1) {
      fake.failNextStart = { kind: "runner-error", code: "boom", message: "boom" };
      await worker.tick();
      behindStates.push(stateOf(behind));
    }
    expect(behindStates).toEqual(["queued", "queued", "queued", "running"]);

    const found = getRunWithRecords(h.db, head.id);
    expect(found?.run).toMatchObject({
      state: "ended",
      agentResult: "could-not-start",
      prState: "none",
      startedAt: null,
    });
    expect(found?.records.startFailures).toBe(MAX_START_RETRIES + 1);
    expect(found?.records.startError).toContain("boom");
    expect(stateOf(behind)).toBe("running");
    expect(fake.startCalls.filter((c) => c.worktreeName === head.worktreeName)).toHaveLength(
      MAX_START_RETRIES + 1,
    );
  });

  it("읽을 수 없는 출력 뒤에는 같은 이름으로 먼저 찾아 이어 붙이고 다시 보내지 않는다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    const fakeA = h.runner(runnerA);
    fakeA.loseNextStartResponse = true;
    const startRun = fakeA.startRun.bind(fakeA);
    let first = true;
    fakeA.startRun = async (input) => {
      try {
        return await startRun(input);
      } catch (error) {
        if (!first) throw error;
        first = false;
        throw new AdapterError({ kind: "malformed-output", raw: "{" });
      }
    };
    const worker = h.worker();

    await worker.tick();
    expect(getRunWithRecords(h.db, run.id)?.records).toMatchObject({ startFailures: 1 });
    await worker.tick();
    expect(current(run)).toMatchObject({ state: "running", runnerId: runnerA });
    expect(fakeA.startCalls).toHaveLength(1);
  });

  it("결과를 모르는 시작이 있는 런은 Mapping이 지워져도 확인 전에 시작할 수 없음으로 끝내지 않는다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    h.runner(runnerA).loseNextStartResponse = true;
    const worker = h.worker();

    await worker.tick();
    h.db.$client.prepare("DELETE FROM mappings").run();
    await worker.tick();
    expect(current(run)).toMatchObject({ state: "running", runnerId: runnerA });
  });

  it("결과를 모르는 런이 시작하지 않았다고 확인됐는데 Mapping이 지워졌으면 새로 시작하지 않고 시작할 수 없음으로 끝낸다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    const fakeA = h.runner(runnerA);
    fakeA.failNextStart = { kind: "start-outcome-unknown", detail: "lost" };
    const worker = h.worker();

    await worker.tick();
    h.db.$client.prepare("DELETE FROM mappings").run();
    await worker.tick();
    expect(current(run)).toMatchObject({ state: "ended", agentResult: "could-not-start" });
    expect(fakeA.startCalls).toHaveLength(1);
  });

  it("런타임이 꺼진 러너(not-ready)는 우편함 준비에서 실패해도 뒤 런을 막지 않는다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const runnerB = h.addRunner({ id: "runner-b", capacity: 1, projects: [projectB] });
    const head = h.assign("ENG-1", projectA);
    const behind = h.assign("ENG-2", projectB);
    h.runner(runnerA).ensureMailbox = () =>
      Promise.reject(new AdapterError({ kind: "not-ready", detail: "runtime down" }));

    await h.worker().tick();
    expect(current(head)).toMatchObject({ state: "queued" });
    expect(current(behind)).toMatchObject({ state: "running", runnerId: runnerB });
  });

  it("시작 때 러너에 닿지 못하면 순서에서 빼 뒤 런을 막지 않고, 시도 횟수에 넣지 않는다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const runnerB = h.addRunner({ id: "runner-b", capacity: 1, projects: [projectB] });
    const head = h.assign("ENG-1", projectA);
    const behind = h.assign("ENG-2", projectB);
    h.runner(runnerA).failNextStart = { kind: "unreachable", detail: "ssh: timeout" };
    const worker = h.worker();

    await worker.tick();
    expect(current(head)).toMatchObject({ state: "queued", runnerId: null });
    expect(current(behind)).toMatchObject({ state: "running", runnerId: runnerB });
    expect(getRunWithRecords(h.db, head.id)?.records).toMatchObject({
      startFailures: 0,
      startRequestedAt: null,
    });

    h.advance(START_UNREACHABLE_RETRY_MS);
    await worker.tick();
    expect(current(head)).toMatchObject({ state: "running", runnerId: runnerA });
  });

  it("시작 때 러너에 닿지 못한 런은 맞는 다른 러너가 있으면 그 러너에서 시작한다 (Q86)", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const runnerB = h.addRunner({ id: "runner-b", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    expect(current(run)).toMatchObject({ runnerId: runnerA });
    h.runner(runnerA).online = false;
    const worker = h.worker();

    await worker.tick();
    h.setRunnerOnline(runnerA, false);
    await worker.tick();
    expect(current(run)).toMatchObject({ state: "running", runnerId: runnerB });
  });

  it("결과를 모르는 런은 묶인 러너의 GitHub 인증이 깨져도 다른 러너에서 다시 시작하지 않는다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const runnerB = h.addRunner({ id: "runner-b", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    expect(current(run)).toMatchObject({ runnerId: runnerA });
    h.runner(runnerA).loseNextStartResponse = true;
    const worker = h.worker();

    await worker.tick();
    h.setRunnerOnline(runnerA, true, null, true);
    await worker.tick();
    await worker.tick();
    expect(current(run)).toMatchObject({ state: "queued", runnerId: runnerA });
    expect(h.runner(runnerB).startCalls).toHaveLength(0);

    h.setRunnerOnline(runnerA, true, null, false);
    await worker.tick();
    expect(current(run)).toMatchObject({ state: "running", runnerId: runnerA });
    expect(h.runner(runnerA).startCalls).toHaveLength(1);
  });

  it("결과를 모르는 시작을 확인하려다 러너에 닿지 않으면 뒤 런을 막지 않는다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const runnerB = h.addRunner({ id: "runner-b", capacity: 1, projects: [projectB] });
    const head = h.assign("ENG-1", projectA);
    const fakeA = h.runner(runnerA);
    const worker = h.worker();

    fakeA.loseNextStartResponse = true;
    await worker.tick();
    fakeA.online = false;
    const behind = h.assign("ENG-2", projectB);
    await worker.tick();
    await worker.tick();
    expect(current(head)).toMatchObject({ state: "queued", runnerId: runnerA });
    expect(current(behind)).toMatchObject({ state: "running", runnerId: runnerB });
  });

  it("닿지 않는 러너가 DB에 Online으로 남아도 같은 러너의 뒤 런이 다른 러너의 런을 막지 않는다 (Q86)", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const runnerB = h.addRunner({ id: "runner-b", capacity: 1, projects: [projectB] });
    const first = h.assign("ENG-1", projectA);
    const second = h.assign("ENG-2", projectA);
    const other = h.assign("ENG-3", projectB);
    h.runner(runnerA).online = false;
    const worker = h.worker();

    await worker.tick();
    await worker.tick();
    expect(current(other)).toMatchObject({ state: "running", runnerId: runnerB });
    expect([stateOf(first), stateOf(second)]).toEqual(["queued", "queued"]);

    h.runner(runnerA).online = true;
    h.advance(START_UNREACHABLE_RETRY_MS);
    await worker.tick();
    expect(current(first)).toMatchObject({ state: "running", runnerId: runnerA });
    expect(stateOf(second)).toBe("queued");
  });

  it("이미 시작을 보낸 런이 러너에 닿지 못해도 다른 러너에서 다시 시작하지 않는다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const runnerB = h.addRunner({ id: "runner-b", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    expect(current(run)).toMatchObject({ runnerId: runnerA });
    const fakeA = h.runner(runnerA);
    const worker = h.worker();

    fakeA.loseNextStartResponse = true;
    await worker.tick();
    fakeA.online = false;
    await worker.tick();
    await worker.tick();
    expect(current(run)).toMatchObject({ state: "queued", runnerId: runnerA });
    expect(h.runner(runnerB).startCalls).toHaveLength(0);

    fakeA.online = true;
    h.advance(START_UNREACHABLE_RETRY_MS);
    await worker.tick();
    expect(current(run)).toMatchObject({ state: "running", runnerId: runnerA });
    expect(fakeA.startCalls).toHaveLength(1);
  });

  it("맨 앞 런의 Mapping이 지워졌으면 시작할 수 없음으로 끝내 뒤 런이 막히지 않는다", async () => {
    h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const head = h.assign("ENG-1", projectA);
    h.db.$client.prepare("DELETE FROM mappings").run();

    await h.worker().tick();
    expect(current(head)).toMatchObject({
      state: "ended",
      agentResult: "could-not-start",
      prState: "none",
    });
  });
});

describe("러너 쪽 변화로 러너를 비움 (Q78·Q82.22)", () => {
  it("GitHub 인증이 깨진 러너로 정한 Queued 런은 러너를 비우고 순서에서 빠진다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    h.addRunner({ id: "runner-b", capacity: 1, projects: [projectB] });
    const busy = h.assign("ENG-1", projectA);
    const worker = h.worker();
    await worker.tick();
    const waiting = h.assign("ENG-2", projectA);
    const behind = h.assign("ENG-3", projectB);
    expect(current(waiting)).toMatchObject({ runnerId: runnerA });

    h.setRunnerOnline(runnerA, true, null, true);
    await worker.tick();
    expect(current(waiting)).toMatchObject({ state: "queued", runnerId: null });
    expect(stateOf(behind)).toBe("running");
    expect(stateOf(busy)).toBe("running");
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
      finish(run);
      await vi.waitFor(() => expect(stateOf(run)).toBe("ended"));
    } finally {
      await worker.stop();
    }
  });
});
