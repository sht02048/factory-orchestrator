import { FAKE_AGENT_PROTOCOL } from "@ganger/core/testing";
import type { RunId, RunnerId } from "@ganger/core";
import {
  changeRunState,
  continueRun,
  getRun,
  getRunWithRecords,
  listTakenOverRunIds,
  requestWorktreeRemoval,
  saveWorkspaceBrief,
  setQueuedRunRunner,
  updateRunRecords,
} from "@ganger/db";
import type { StoredRun } from "@ganger/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Harness, projectA, workspaceId } from "./test-fixtures.js";

let h: Harness;

beforeEach(() => {
  h = new Harness();
});

afterEach(async () => {
  await h.cleanup();
});

type StartedEnded = Extract<StoredRun, { state: "ended" }> & { worktree: NonNullable<unknown> };

async function endedRun(runnerId: RunnerId, key = "ENG-1"): Promise<StartedEnded> {
  const run = h.assign(key, projectA);
  await h.worker().tick();
  const report = "Committed locally. Push is left.";
  const result = changeRunState(
    h.db,
    run.id,
    { to: "ended", agentResult: "reported-success", prState: "none", reportBody: report },
    h.now,
  );
  if (!result.ok || result.run.state !== "ended" || result.run.worktree === null) {
    throw new Error(`could not end run on ${runnerId}`);
  }
  updateRunRecords(h.db, run.id, { worktreeKept: "unpushed-commits" });
  return { ...result.run, worktree: result.run.worktree };
}

function continued(from: RunId, message = "Push and open the PR."): StoredRun {
  h.advance(1000);
  const result = continueRun(h.db, { from, message, now: h.now });
  if (!result.ok) throw new Error(`continue failed: ${result.reason}`);
  return result.run;
}

function records(run: StoredRun) {
  const found = getRunWithRecords(h.db, run.id);
  if (found === null) throw new Error("run is gone");
  return found.records;
}

describe("이어서 맡기기", () => {
  it("같은 러너·워크트리·브랜치로 새 런을 시작하고 지시서를 순서대로 보낸다", async () => {
    const runnerId = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    h.addRunner({ id: "runner-b", capacity: 5, projects: [projectA] });
    saveWorkspaceBrief(h.db, { id: workspaceId, brief: { before: "Before.", after: "After." } });
    const source = await endedRun(runnerId);
    const fake = h.runner(source.runnerId);
    const startsBefore = fake.startCalls.length;

    const next = continued(source.id);
    await h.worker().tick();

    const started = getRun(h.db, next.id);
    expect(started).toMatchObject({
      state: "running",
      runnerId: source.runnerId,
      worktree: source.worktree,
      branch: source.branch,
      continuedFromRunId: source.id,
    });
    expect(records(next).continuePlace).toBe("same-worktree");
    const call = fake.startCalls[startsBefore];
    expect(call?.continueIn).toBe(source.worktree);
    const expected = [
      "## 운영자의 말\n\nPush and open the PR.",
      "## 이전 런의 완료 보고\n\nCommitted locally. Push is left.",
      "Before.",
      "After.",
      FAKE_AGENT_PROTOCOL,
    ].join("\n\n");
    expect(call?.brief).toBe(`${expected}\n`);
    expect(records(next).agentBrief).toBe(`${expected}\n`);
  });

  it("워크트리가 지워졌으면 같은 브랜치로 다시 만들어 시작하고 그 사실을 남긴다", async () => {
    const runnerId = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const source = await endedRun(runnerId);
    const fake = h.runner(source.runnerId);
    fake.deleteWorktree(source.worktree);

    const next = continued(source.id);
    await h.worker().tick();

    expect(getRun(h.db, next.id)).toMatchObject({
      state: "running",
      worktree: source.worktree,
      branch: source.branch,
    });
    expect(records(next).continuePlace).toBe("recreated");
  });

  it("다시 만든 워크트리는 시작하지 못해도 이전 런의 남은 워크트리로 돌아온다", async () => {
    const runnerId = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const source = await endedRun(runnerId);
    const fake = h.runner(source.runnerId);
    fake.deleteWorktree(source.worktree);
    expect(requestWorktreeRemoval(h.db, source.id, h.now)).toEqual({ ok: true });
    updateRunRecords(h.db, source.id, { worktreeRemovedAt: h.now });
    fake.failNextStart = { kind: "runner-error", code: "boom", message: "failed" };

    const next = continued(source.id);
    await h.worker().tick();

    expect(records(next).continuePlace).toBe("recreated");
    expect(getRunWithRecords(h.db, source.id)?.records).toMatchObject({
      worktreeRemovedAt: null,
      worktreeRemoveRequestedAt: null,
    });
    expect(fake.removed).toEqual([]);
  });

  it("재시도 사이에 워크트리가 지워지면 이어 받은 곳을 다시 만든 것으로 고친다", async () => {
    const runnerId = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const source = await endedRun(runnerId);
    const fake = h.runner(source.runnerId);
    fake.failNextStart = { kind: "runner-error", code: "boom", message: "failed" };
    const next = continued(source.id);
    const worker = h.worker();
    await worker.tick();
    expect(records(next).continuePlace).toBe("same-worktree");

    fake.deleteWorktree(source.worktree);
    await worker.tick();

    expect(records(next).continuePlace).toBe("recreated");
    expect(getRun(h.db, next.id)?.state).toBe("running");
  });

  it("브랜치도 없으면 새 워크트리에서 티켓과 함께 처음부터 시작한다", async () => {
    const runnerId = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const source = await endedRun(runnerId);
    const fake = h.runner(source.runnerId);
    fake.deleteWorktree(source.worktree);
    fake.goneBranches.add(source.branch);

    const next = continued(source.id);
    await h.worker().tick();

    const started = getRun(h.db, next.id);
    expect(started?.state).toBe("running");
    expect(started).not.toMatchObject({ worktree: source.worktree });
    expect(records(next).continuePlace).toBe("from-scratch");
    const call = fake.startCalls.at(-1);
    expect(call?.continueIn).toBeUndefined();
    expect(call?.brief).toContain("Ticket ENG-1\n\nDo the thing.");
  });

  it("시작 결과를 모르면 같은 워크트리에 에이전트를 두 번 띄우지 않는다", async () => {
    const runnerId = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const source = await endedRun(runnerId);
    const fake = h.runner(source.runnerId);
    fake.loseNextStartResponse = true;
    const startsBefore = fake.startCalls.length;

    const next = continued(source.id);
    const worker = h.worker();
    await worker.tick();
    await worker.tick();

    expect(fake.startCalls.length).toBe(startsBefore + 1);
    expect(getRun(h.db, next.id)?.state).toBe("running");
  });

  it("러너에 자리가 없으면 다른 러너로 옮기지 않고 기다렸다가 그 러너에서 시작한다", async () => {
    const runnerId = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const source = await endedRun(runnerId);
    const blocker = h.assign("ENG-2", projectA);
    const worker = h.worker();
    await worker.tick();
    expect(getRun(h.db, blocker.id)).toMatchObject({ state: "running", runnerId });
    h.addRunner({ id: "runner-b", capacity: 5, projects: [projectA] });

    const next = continued(source.id);
    await worker.tick();
    expect(getRun(h.db, next.id)).toMatchObject({ state: "queued", runnerId });

    changeRunState(
      h.db,
      blocker.id,
      { to: "ended", agentResult: "reported-failure", prState: "none" },
      h.now,
    );
    await worker.tick();

    expect(getRun(h.db, next.id)).toMatchObject({ state: "running", runnerId });
  });

  it("러너가 Offline 이면 런을 비우지 않고 돌아올 때까지 기다린다", async () => {
    const runnerId = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const source = await endedRun(runnerId);
    h.addRunner({ id: "runner-b", capacity: 5, projects: [projectA] });
    h.setRunnerOnline(runnerId, false, [projectA], false);

    const next = continued(source.id);
    expect(setQueuedRunRunner(h.db, next.id, null)).toBe(false);

    expect(getRun(h.db, next.id)).toMatchObject({ state: "queued", runnerId });
  });

  it("러너 연결이 끊긴 채 끝난 런은 이전 에이전트를 멈춘 뒤 같은 워크트리에서 시작한다", async () => {
    const runnerId = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);
    await h.worker().tick();
    const ended = changeRunState(
      h.db,
      run.id,
      { to: "ended", agentResult: "runner-disconnected", prState: "none" },
      h.now,
    );
    if (!ended.ok || ended.run.state !== "ended" || ended.run.worktree === null) {
      throw new Error("could not end run");
    }
    const worktree = ended.run.worktree;
    const fake = h.runner(runnerId);

    const next = continued(run.id);
    await h.worker().tick();

    expect(fake.runs.get(run.worktreeName)?.agentStopped).toBe(true);
    expect(getRun(h.db, next.id)).toMatchObject({ state: "running", worktree });
  });

  it("이어 받은 뒤에는 이전 런이 워크트리를 지우지 못한다", async () => {
    const runnerId = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const source = await endedRun(runnerId);
    const fake = h.runner(source.runnerId);
    const next = continued(source.id);
    const worker = h.worker();
    await worker.tick();

    expect(requestWorktreeRemoval(h.db, source.id, h.now)).toEqual({
      ok: false,
      reason: "taken-over",
    });
    await worker.tick();

    expect(fake.removed).toEqual([]);
    expect(getRun(h.db, next.id)?.state).toBe("running");
  });

  it("이어 받은 런이 있는 이전 런만 넘겨준 런으로 센다", async () => {
    const runnerId = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const source = await endedRun(runnerId);
    expect(listTakenOverRunIds(h.db).has(source.id)).toBe(false);

    const next = continued(source.id);
    expect(listTakenOverRunIds(h.db).has(source.id)).toBe(true);

    changeRunState(h.db, next.id, { to: "ended", agentResult: "canceled", prState: "none" }, h.now);
    expect(listTakenOverRunIds(h.db).has(source.id)).toBe(false);
  });

  it("같은 런을 두 번 이어 맡기지 못하고, 시작 못 한 이어 받기 뒤에는 다시 맡길 수 있다", async () => {
    const runnerId = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const source = await endedRun(runnerId);
    const first = continued(source.id);

    expect(continueRun(h.db, { from: source.id, message: "again", now: h.now })).toEqual({
      ok: false,
      reason: "active-run",
    });

    changeRunState(
      h.db,
      first.id,
      { to: "ended", agentResult: "canceled", prState: "none" },
      h.now,
    );
    expect(continueRun(h.db, { from: source.id, message: "again", now: h.now }).ok).toBe(true);
  });

  it("워크트리를 지우는 중인 런은 이어 맡기지 못한다", async () => {
    const runnerId = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const source = await endedRun(runnerId);
    expect(requestWorktreeRemoval(h.db, source.id, h.now)).toEqual({ ok: true });

    expect(continueRun(h.db, { from: source.id, message: "go", now: h.now })).toEqual({
      ok: false,
      reason: "worktree-removing",
    });
  });
});
