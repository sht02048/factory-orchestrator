import { describe, expect, it } from "vitest";

import { AdapterError } from "../adapters.js";
import type { CodeHost, PullRequestSnapshot, Runner, Tracker } from "../adapters.js";
import {
  toLabelId,
  toRepoRef,
  toRunnerProjectId,
  toTicketKey,
  toTrackerProjectId,
  toTrackerStateId,
} from "../ids.js";
import { FakeCodeHost, FakeRunner, FakeTracker } from "./index.js";

// 가짜 어댑터 셋이 인터페이스를 만족하는지 typecheck로 확인한다.
const _tracker: Tracker = new FakeTracker();
const _runner: Runner = new FakeRunner();
const _codeHost: CodeHost = new FakeCodeHost();

const app = toRunnerProjectId("fake:acme/app");
const project = { id: app, displayName: "app", setupState: "ready" };

describe("FakeRunner", () => {
  it("따로 정하지 않으면 Online이고 테스트가 넣은 러너 쪽 프로젝트를 가진다고 답한다", async () => {
    const runner = new FakeRunner();
    runner.setProjects([project]);

    await expect(runner.checkHealth()).resolves.toMatchObject({
      online: true,
      prerequisites: [{ satisfied: true }],
      error: null,
    });
    await expect(runner.listProjects()).resolves.toEqual([project]);
  });

  it("런을 시작하고 테스트가 정한 진행을 돌려주며, 사라진 워크트리는 gone이다", async () => {
    const runner = new FakeRunner();
    runner.setProjects([project]);
    const started = await runner.startRun({
      project: app,
      worktreeName: "ENG-1",
      branch: "factory/ENG-1-1",
      agent: "claude",
      prompt: "티켓 본문",
    });

    await expect(runner.pollRun(started.worktree)).resolves.toMatchObject({ kind: "running" });

    runner.setProgress(started.worktree, { kind: "finished", exitCode: 0 });
    await expect(runner.pollRun(started.worktree)).resolves.toEqual({
      kind: "finished",
      exitCode: 0,
    });

    await runner.removeWorktree(started.worktree, { force: false });
    await expect(runner.worktreeExists(started.worktree)).resolves.toBe(false);
    await expect(runner.pollRun(started.worktree)).resolves.toEqual({ kind: "gone" });
  });

  it("같은 retryToken으로 다시 시작하면 같은 시작을 돌려준다", async () => {
    const runner = new FakeRunner();
    runner.setProjects([project]);
    const input = { project: app, worktreeName: "w", branch: "b", agent: "a", prompt: "p" };
    const first = await runner.startRun(input);

    expect(first.retryToken).not.toBeNull();
    const again = await runner.startRun({ ...input, retryToken: first.retryToken ?? "" });

    expect(again).toEqual(first);
    expect(runner.worktrees.size).toBe(1);
  });

  it("로그 꼬리는 요청한 줄 수만큼 돌려주고 0줄이면 비어 있다", async () => {
    const runner = new FakeRunner();
    runner.setProjects([project]);
    const { worktree } = await runner.startRun({
      project: app,
      worktreeName: "w",
      branch: "b",
      agent: "a",
      prompt: "p",
    });
    runner.appendLog(worktree, "1", "2", "3");

    await expect(runner.readLogTail(worktree, { lines: 2 })).resolves.toEqual(["2", "3"]);
    await expect(runner.readLogTail(worktree, { lines: 0 })).resolves.toEqual([]);
  });

  it("Offline 러너에 닿는 호출은 unreachable로 실패한다", async () => {
    const runner = new FakeRunner();
    runner.online = false;

    await expect(runner.checkHealth()).resolves.toMatchObject({ online: false });
    const error = await runner.listProjects().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ detail: { kind: "unreachable" } });
  });
});

describe("FakeCodeHost", () => {
  const repo = toRepoRef("acme/app");
  const pr: PullRequestSnapshot = {
    number: 7,
    url: "https://example.com/acme/app/pull/7",
    title: "ENG-1 고치기",
    body: "",
    state: "open",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    mergedAt: null,
    headRefName: "factory/ENG-1-1",
    headRepository: repo,
    headSha: "abc",
    baseRefName: "main",
    ci: "pending",
  };

  it("러너 쪽 프로젝트에서 저장소를 읽고, 브랜치·티켓 키·번호로 넣은 PR을 찾는다", async () => {
    const codeHost = new FakeCodeHost();
    codeHost.putPullRequest(repo, pr);

    expect(codeHost.repoOf(app)).toBe(repo);
    expect(codeHost.repoOf(toRunnerProjectId("other:acme/app"))).toBeNull();
    await expect(codeHost.findPullRequestsByBranch(repo, pr.headRefName)).resolves.toEqual([pr]);
    await expect(codeHost.findPullRequestsByTicketKey(repo, toTicketKey("ENG-1"))).resolves.toEqual(
      [pr],
    );
    await expect(codeHost.getPullRequest(repo, 7)).resolves.toEqual(pr);
    await expect(codeHost.getPullRequest(repo, 8)).resolves.toBeNull();
  });
});

describe("FakeTracker", () => {
  it("상태 변경과 댓글을 기록한다", async () => {
    const tracker = new FakeTracker();
    const key = toTicketKey("ENG-1");
    const projectId = toTrackerProjectId("p1");
    const auto = toLabelId("l1");
    tracker.states.set(projectId, [
      { id: toTrackerStateId("s-progress"), name: "In Progress", category: "started" },
    ]);
    tracker.addTicket({
      key,
      title: "티켓",
      body: "",
      url: "https://example.com/ENG-1",
      labels: [{ id: auto, name: "auto" }],
      project: { id: projectId, name: "앱" },
      state: { id: toTrackerStateId("s-todo"), name: "Todo", category: "unstarted" },
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });

    await tracker.setState(key, toTrackerStateId("s-progress"));
    await tracker.addComment(key, "결과");

    await expect(tracker.getTicket(key)).resolves.toMatchObject({
      state: { name: "In Progress" },
    });
    await expect(tracker.listComments(key)).resolves.toMatchObject({
      items: [{ body: "결과" }],
      nextCursor: null,
    });
    await expect(tracker.listProjectTickets(projectId)).resolves.toMatchObject({
      items: [{ key }],
    });
    await expect(
      tracker.listLabeledTickets({ labelId: auto, updatedSince: new Date(0) }),
    ).resolves.toHaveLength(1);
  });
});
