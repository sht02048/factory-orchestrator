import { DISCONNECT_AFTER_MS, summarizeRunOutcome, toTrackerStateId } from "@factory/core";
import type { PullRequestSnapshot, RunnerId, WorktreeRef } from "@factory/core";
import {
  DEFAULT_MAX_RUN_MS,
  LAST_LOG_LINES,
  getLogTailRequest,
  getRun,
  getRunWithRecords,
  getRunnerCheckRequest,
  listRunners,
  requestLogTail,
  requestRunCancel,
  requestRunnerCheck,
  saveWorkspaceTrackerProject,
  toWorkspaceId,
  updateRunRecords,
} from "@factory/db";
import type { StoredRun } from "@factory/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PR_POLL_INTERVAL_MS } from "./after-run.js";
import { RUNNER_CHECK_INTERVAL_MS } from "./runner-check.js";
import { Harness, connection, projectA, repoOf, trackerProject } from "./test-fixtures.js";
import type { Worker } from "./worker.js";

let h: Harness;

beforeEach(() => {
  h = new Harness();
});

afterEach(async () => {
  await h.cleanup();
});

const inProgress = toTrackerStateId("in-progress");

function chooseInProgress(): void {
  saveWorkspaceTrackerProject(h.db, {
    workspaceId: toWorkspaceId("ws-1"),
    connection,
    projectId: trackerProject,
    name: "Web",
    inProgressStateId: inProgress,
  });
}

function current(run: StoredRun): StoredRun {
  const found = getRun(h.db, run.id);
  if (found === null) throw new Error(`run ${run.id} is gone`);
  return found;
}

function recordsOf(run: StoredRun) {
  const found = getRunWithRecords(h.db, run.id);
  if (found === null) throw new Error(`run ${run.id} is gone`);
  return found.records;
}

function worktreeOf(run: StoredRun): WorktreeRef {
  const found = current(run);
  if (found.state === "queued" || found.worktree === null) throw new Error("run has not started");
  return found.worktree;
}

function ended(run: StoredRun) {
  const found = current(run);
  if (found.state !== "ended") throw new Error(`run ${run.id} is ${found.state}, not ended`);
  return found;
}

async function startOne(key = "ENG-1"): Promise<{
  run: StoredRun;
  runnerId: RunnerId;
  worker: Worker;
}> {
  const runnerId = h.addRunner({ id: "runner-a", capacity: 2, projects: [projectA] });
  const run = h.assign(key, projectA);
  const worker = h.worker();
  await worker.tick();
  expect(current(run).state).toBe("running");
  return { run, runnerId, worker };
}

function report(run: StoredRun, runnerId: RunnerId, outcome = "succeeded"): void {
  h.runner(runnerId).report(worktreeOf(run), { outcome, body: "끝" });
}

async function settlePullRequest(run: StoredRun, state: "merged" | "closed"): Promise<void> {
  const found = current(run);
  if (found.state === "queued" || found.branch === null) throw new Error("run has not started");
  const repo = repoOf(found.runnerProject);
  const [pr] = await h.codeHost.findPullRequestsByBranch(repo, found.branch);
  if (pr === undefined) throw new Error("no pull request");
  const settled: PullRequestSnapshot = {
    ...pr,
    state,
    mergedAt: state === "merged" ? h.now : null,
  };
  h.codeHost.putPullRequest(repo, settled);
}

describe("트래커 갱신", () => {
  it("런 시작 때 In Progress로 한 번, 끝날 때 결과 댓글을 한 번 달고 다시 띄워도 댓글은 하나다", async () => {
    chooseInProgress();
    const runnerId = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    h.setRunnerOnline(runnerId, false);
    const run = h.assign("ENG-1", projectA);
    const worker = h.worker();
    await worker.tick();
    expect(current(run).state).toBe("queued");
    expect(h.tracker.stateChanges).toEqual([]);

    h.setRunnerOnline(runnerId, true);
    await worker.tick();
    expect(current(run).state).toBe("running");
    expect(h.tracker.stateChanges).toEqual([{ key: run.ticket.key, stateId: inProgress }]);
    expect(recordsOf(run).trackerStateSetAt).toEqual(h.now);

    await worker.tick();
    expect(h.tracker.stateChanges).toHaveLength(1);

    h.putPullRequest(current(run), "open");
    report(run, runnerId);
    await worker.tick();
    expect(ended(run)).toMatchObject({ agentResult: "reported-success", prState: "open" });
    const comments = h.tracker.comments.get(run.ticket.key) ?? [];
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toContain("Human Check");
    expect(comments[0]?.body).toContain("완료 보고(성공)");
    expect(comments[0]?.body).toContain("열림");
    expect(comments[0]?.body).toContain("https://code.example.com/acme/pull/1");
    expect(comments[0]?.body).toContain(run.id);
    expect(recordsOf(run).trackerComment).toEqual({ id: comments[0]?.id, at: h.now });

    await worker.close();
    const restarted = h.worker();
    await restarted.tick();
    await restarted.tick();
    expect(h.tracker.comments.get(run.ticket.key)).toHaveLength(1);
    expect(h.tracker.stateChanges).toHaveLength(1);
  });

  it("댓글을 단 뒤 기록하지 못한 채 데몬이 멈춰도 다시 띄웠을 때 같은 댓글을 찾아 기록만 한다", async () => {
    const { run, runnerId, worker } = await startOne();
    report(run, runnerId);
    await worker.tick();
    const [comment] = h.tracker.comments.get(run.ticket.key) ?? [];
    expect(comment).toBeDefined();
    updateRunRecords(h.db, run.id, { trackerComment: null });
    await worker.close();

    await h.worker().tick();
    expect(h.tracker.comments.get(run.ticket.key)).toHaveLength(1);
    expect(recordsOf(run).trackerComment?.id).toBe(comment?.id);
  });

  it("In Progress 상태를 고르지 않았으면 상태를 바꾸지 않는다", async () => {
    await startOne();
    expect(h.tracker.stateChanges).toEqual([]);
  });

  it("트래커 호출이 실패하면 기록하지 않고 다음 바퀴에 다시 한다", async () => {
    chooseInProgress();
    const spy = vi.spyOn(h.tracker, "setState").mockRejectedValueOnce(new Error("network"));
    const { run, worker } = await startOne();
    expect(recordsOf(run).trackerStateSetAt).toBeNull();
    await worker.tick();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(recordsOf(run).trackerStateSetAt).toEqual(h.now);
  });
});

describe("워크트리 정리", () => {
  it("바로 지움인 런(Merged)은 끝난 바퀴에 워크트리를 지우고 지운 시각을 기록한다", async () => {
    const { run, runnerId, worker } = await startOne();
    const worktree = worktreeOf(run);
    h.putPullRequest(current(run), "merged");
    report(run, runnerId);
    await worker.tick();
    expect(summarizeRunOutcome(ended(run)).worktree).toBe("remove-now");
    expect(h.runner(runnerId).removed).toEqual([worktree]);
    expect(recordsOf(run).worktreeRemovedAt).toEqual(h.now);

    await worker.tick();
    expect(h.runner(runnerId).removed).toHaveLength(1);
  });

  it("트래커가 실패해도 워크트리는 지우고, 댓글은 다음 바퀴에 단다", async () => {
    const { run, runnerId, worker } = await startOne();
    const spy = vi
      .spyOn(h.tracker, "listComments")
      .mockRejectedValueOnce(new Error("unauthorized"));
    report(run, runnerId);
    await worker.tick();
    expect(ended(run).agentResult).toBe("reported-success");
    expect(h.runner(runnerId).removed).toHaveLength(1);
    expect(recordsOf(run).trackerComment).toBeNull();

    await worker.tick();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(h.tracker.comments.get(run.ticket.key)).toHaveLength(1);
  });

  it("러너가 Offline이면 지우지 않고 돌아오면 지운다", async () => {
    const { run, runnerId, worker } = await startOne();
    report(run, runnerId, "failed");
    h.setRunnerOnline(runnerId, false);
    h.runner(runnerId).online = true;
    await worker.tick();
    expect(ended(run).agentResult).toBe("reported-failure");
    expect(h.runner(runnerId).removed).toEqual([]);

    h.advance(RUNNER_CHECK_INTERVAL_MS);
    await worker.tick();
    expect(h.runner(runnerId).removed).toHaveLength(1);
    expect(recordsOf(run).worktreeRemovedAt).toEqual(h.now);
  });

  it("PR이 열린 런은 남기고, PR이 병합되면 이후 PR 상태를 기록한 뒤 지우며 두 축은 그대로다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.putPullRequest(current(run), "open");
    report(run, runnerId);
    await worker.tick();
    const axes = ended(run);
    expect(summarizeRunOutcome(axes)).toEqual({
      outcome: "human-check",
      worktree: "keep-until-pr-settles",
    });
    expect(h.runner(runnerId).removed).toEqual([]);

    h.advance(PR_POLL_INTERVAL_MS);
    await worker.tick();
    expect(h.runner(runnerId).removed).toEqual([]);
    expect(recordsOf(run).laterPrState).toBeNull();

    await settlePullRequest(run, "merged");
    await worker.tick();
    expect(recordsOf(run).laterPrState).toBeNull();

    h.advance(PR_POLL_INTERVAL_MS);
    await worker.tick();
    expect(recordsOf(run).laterPrState).toEqual({ state: "merged", at: h.now });
    expect(h.runner(runnerId).removed).toEqual([worktreeOf(run)]);
    expect(recordsOf(run).worktreeRemovedAt).toEqual(h.now);
    expect(ended(run)).toMatchObject({
      agentResult: axes.agentResult,
      prState: "open",
      runnerUnreached: false,
    });
    expect(summarizeRunOutcome(ended(run)).outcome).toBe("human-check");
  });

  it("PR 열린 시간 초과 런은 PR이 닫히면 이후 PR 상태 닫힘을 기록하고 지운다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.putPullRequest(current(run), "open");
    h.advance(DEFAULT_MAX_RUN_MS);
    await worker.tick();
    expect(ended(run)).toMatchObject({ agentResult: "timed-out", prState: "open" });
    expect(h.runner(runnerId).removed).toEqual([]);

    await settlePullRequest(run, "closed");
    h.advance(PR_POLL_INTERVAL_MS);
    await worker.tick();
    expect(recordsOf(run).laterPrState?.state).toBe("closed");
    expect(h.runner(runnerId).removed).toEqual([worktreeOf(run)]);
    expect(ended(run)).toMatchObject({ agentResult: "timed-out", prState: "open" });
  });

  it("워크트리 없음 런은 지우기를 부르지 않는다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.runner(runnerId).deleteWorktree(worktreeOf(run));
    await worker.tick();
    expect(ended(run).agentResult).toBe("worktree-missing");
    await worker.tick();
    expect(h.runner(runnerId).removed).toEqual([]);
    expect(recordsOf(run).worktreeRemovedAt).toBeNull();
  });

  it("Queued에서 취소한 런은 지우기를 부르지 않고 지운 시각도 남기지 않는다", async () => {
    const runnerId = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    h.setRunnerOnline(runnerId, false);
    const run = h.assign("ENG-1", projectA);
    requestRunCancel(h.db, run.id, h.now);
    const worker = h.worker();
    await worker.tick();
    expect(ended(run).agentResult).toBe("canceled");
    h.setRunnerOnline(runnerId, true);
    await worker.tick();
    expect(h.runner(runnerId).removed).toEqual([]);
    expect(recordsOf(run).worktreeRemovedAt).toBeNull();
    expect(h.tracker.comments.get(run.ticket.key)).toHaveLength(1);
  });

  it("러너 연결 끊김 런의 워크트리는 러너가 돌아와도 지우지 않고, 사람이 지우면 러너 확인 때 지운 시각을 기록한다", async () => {
    const { run, runnerId, worker } = await startOne();
    const worktree = worktreeOf(run);
    h.runner(runnerId).online = false;
    await worker.tick();
    h.advance(DISCONNECT_AFTER_MS);
    await worker.tick();
    expect(current(run).state).toBe("disconnected");
    h.advance(DEFAULT_MAX_RUN_MS);
    await worker.tick();
    expect(ended(run).agentResult).toBe("runner-disconnected");
    expect(summarizeRunOutcome(ended(run)).worktree).toBe("operator-decides");

    h.runner(runnerId).online = true;
    h.advance(RUNNER_CHECK_INTERVAL_MS);
    await worker.tick();
    h.advance(RUNNER_CHECK_INTERVAL_MS);
    await worker.tick();
    expect(listRunners(h.db).find((r) => r.id === runnerId)?.online).toBe(true);
    expect(h.runner(runnerId).removed).toEqual([]);
    expect(recordsOf(run).worktreeRemovedAt).toBeNull();

    h.runner(runnerId).deleteWorktree(worktree);
    await worker.tick();
    expect(recordsOf(run).worktreeRemovedAt).toBeNull();
    h.advance(RUNNER_CHECK_INTERVAL_MS);
    await worker.tick();
    expect(recordsOf(run).worktreeRemovedAt).toEqual(h.now);
    expect(h.runner(runnerId).removed).toEqual([]);
  });
});

describe("PR·CI 상태와 마지막 로그", () => {
  it("끝나지 않은 런의 PR과 CI 상태를 폴링해 쓴다", async () => {
    const { run, worker } = await startOne();
    expect(recordsOf(run).pullRequest).toBeNull();
    h.putPullRequest(current(run), "open");
    await worker.tick();
    expect(recordsOf(run).pullRequest).toBeNull();
    h.advance(PR_POLL_INTERVAL_MS);
    await worker.tick();
    expect(recordsOf(run).pullRequest).toMatchObject({
      displayId: "#1",
      url: "https://code.example.com/acme/pull/1",
      ci: "success",
      checkedAt: h.now,
    });
  });

  it("런이 끝날 때 에이전트를 닫기 전에 마지막 200줄을 저장한다", async () => {
    const { run, runnerId, worker } = await startOne();
    const fake = h.runner(runnerId);
    const lines = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`);
    fake.appendLog(worktreeOf(run), ...lines);
    const order: string[] = [];
    const read = fake.readLogTail.bind(fake);
    vi.spyOn(fake, "readLogTail").mockImplementation((target, opts) => {
      order.push("read");
      return read(target, opts);
    });
    const close = fake.closeAgent.bind(fake);
    vi.spyOn(fake, "closeAgent").mockImplementation((target) => {
      order.push("close");
      return close(target);
    });
    report(run, runnerId);
    await worker.tick();
    expect(order).toEqual(["read", "close"]);
    expect(recordsOf(run).lastLog).toEqual(lines.slice(-LAST_LOG_LINES));
  });
});

describe("web 요청 처리", () => {
  it("로그 꼬리 요청을 러너에서 읽어 결과를 쓰고 한 번만 처리한다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.runner(runnerId).appendLog(worktreeOf(run), "a", "b");
    requestLogTail(h.db, run.id, h.now);
    const spy = vi.spyOn(h.runner(runnerId), "readLogTail");
    await worker.tick();
    expect(getLogTailRequest(h.db, run.id)).toEqual({
      status: "done",
      requestedAt: h.now,
      completedAt: h.now,
      result: ["a", "b"],
    });
    await worker.tick();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("끝난 런의 로그 꼬리 요청은 저장한 마지막 로그를, Queued 런은 오류를 쓴다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.runner(runnerId).appendLog(worktreeOf(run), "last");
    report(run, runnerId);
    await worker.tick();
    const queued = h.assign("ENG-2", projectA);
    h.setRunnerOnline(runnerId, false);
    requestLogTail(h.db, run.id, h.now);
    requestLogTail(h.db, queued.id, h.now);
    await worker.tick();
    expect(getLogTailRequest(h.db, run.id)).toMatchObject({ status: "done", result: ["last"] });
    expect(getLogTailRequest(h.db, queued.id)).toMatchObject({
      status: "failed",
      error: JSON.stringify({ kind: "run-not-started" }),
    });
  });

  it("러너에 닿지 못하면 로그 꼬리 요청에 오류를 쓴다", async () => {
    const { run, runnerId, worker } = await startOne();
    h.runner(runnerId).online = false;
    requestLogTail(h.db, run.id, h.now);
    await worker.tick();
    const status = getLogTailRequest(h.db, run.id);
    expect(status?.status).toBe("failed");
    expect(status?.status === "failed" && status.error).toContain("unreachable");
  });

  it("러너 확인 요청을 처리해 RunnerHealth를 쓰고 러너 확인 결과도 갱신한다", async () => {
    const runnerId = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const worker = h.worker();
    await worker.tick();
    const check = vi.spyOn(h.runner(runnerId), "checkHealth");
    requestRunnerCheck(h.db, runnerId, h.now);
    await worker.tick();
    const status = getRunnerCheckRequest(h.db, runnerId);
    expect(status).toMatchObject({ status: "done", completedAt: h.now });
    expect(status?.status === "done" && status.result).toMatchObject({ online: true });
    expect(check).toHaveBeenCalledTimes(1);

    await worker.tick();
    expect(check).toHaveBeenCalledTimes(1);

    h.runner(runnerId).online = false;
    h.advance(1000);
    requestRunnerCheck(h.db, runnerId, h.now);
    await worker.tick();
    expect(getRunnerCheckRequest(h.db, runnerId)).toMatchObject({ status: "done" });
    const result = getRunnerCheckRequest(h.db, runnerId);
    expect(result?.status === "done" && result.result).toMatchObject({ online: false });
  });
});
