import { describe, expect, it } from "vitest";

import { AdapterError } from "../adapters.js";
import type {
  CodeHost,
  PullRequestSnapshot,
  Runner,
  RunnerConnection,
  Tracker,
} from "../adapters.js";
import { toRunnerProjectId, toTicketKey } from "../ids.js";
import { FakeCodeHost, FakeRunner, FakeTracker } from "./index.js";

// 가짜 어댑터 셋이 인터페이스를 만족하는지 typecheck로 확인한다.
const _tracker: Tracker = new FakeTracker();
const _runner: Runner = new FakeRunner();
const _codeHost: CodeHost = new FakeCodeHost();

const conn: RunnerConnection = { sshTarget: "runner-a", orcaPath: "/opt/orca/bin/orca" };
const app = toRunnerProjectId("github:acme/app");

describe("FakeRunner", () => {
  it("따로 정하지 않으면 Online이고 테스트가 넣은 러너 쪽 프로젝트를 가진다고 답한다", async () => {
    const runner = new FakeRunner();
    runner.setProjects(conn.sshTarget, [
      { id: app, setupId: "s1", displayName: "app", setupState: "ready" },
    ]);

    await expect(runner.checkHealth(conn)).resolves.toMatchObject({
      online: true,
      serviceInstalled: true,
      error: null,
    });
    await expect(runner.listProjects(conn)).resolves.toEqual([
      { id: app, setupId: "s1", displayName: "app", setupState: "ready" },
    ]);
  });

  it("런을 시작하고 테스트가 정한 진행을 돌려주며, 사라진 워크트리는 gone이다", async () => {
    const runner = new FakeRunner();
    runner.setProjects(conn.sshTarget, [
      { id: app, setupId: "s1", displayName: "app", setupState: "ready" },
    ]);
    const started = await runner.startRun(conn, {
      project: app,
      worktreeName: "ENG-1",
      branch: "factory/ENG-1-1",
      agent: "claude",
      prompt: "티켓 본문",
    });

    await expect(runner.pollRun(conn, started.worktree)).resolves.toMatchObject({
      kind: "running",
    });

    runner.setProgress(started.worktree, { kind: "finished", exitCode: 0 });
    await expect(runner.pollRun(conn, started.worktree)).resolves.toEqual({
      kind: "finished",
      exitCode: 0,
    });

    await runner.removeWorktree(conn, started.worktree, { force: false });
    await expect(runner.worktreeExists(conn, started.worktree)).resolves.toBe(false);
    await expect(runner.pollRun(conn, started.worktree)).resolves.toEqual({ kind: "gone" });
  });

  it("Offline 러너에 닿는 호출은 ssh-failed로 실패한다", async () => {
    const runner = new FakeRunner();
    runner.setOnline(conn.sshTarget, false);

    await expect(runner.checkHealth(conn)).resolves.toMatchObject({ online: false });
    const error = await runner.listProjects(conn).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ detail: { kind: "ssh-failed" } });
  });
});

describe("FakeCodeHost", () => {
  const repo = { owner: "acme", name: "app" };
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
    isCrossRepository: false,
    headSha: "abc",
    baseRefName: "main",
    ci: "pending",
  };

  it("브랜치·티켓 키·번호로 넣은 PR을 찾는다", async () => {
    const codeHost = new FakeCodeHost();
    codeHost.putPullRequest(repo, pr);

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
    tracker.states.set("team", [{ id: "s-progress", name: "In Progress", type: "started" }]);
    tracker.addTicket({
      key,
      trackerId: "uuid",
      title: "티켓",
      body: "",
      url: "https://example.com/ENG-1",
      labels: [{ id: "l1", name: "auto" }],
      project: { id: "p1", name: "앱" },
      team: { id: "team", key: "ENG" },
      state: { id: "s-todo", name: "Todo", type: "unstarted" },
      suggestedBranchName: null,
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });

    await tracker.setState(key, "s-progress");
    await tracker.addComment(key, "결과");

    await expect(tracker.getTicket(key)).resolves.toMatchObject({
      state: { name: "In Progress" },
    });
    await expect(tracker.listComments(key)).resolves.toMatchObject({
      items: [{ body: "결과" }],
      nextCursor: null,
    });
    await expect(tracker.listProjectTickets("p1")).resolves.toMatchObject({ items: [{ key }] });
    await expect(
      tracker.listLabeledTickets({ labelName: "auto", updatedSince: new Date(0) }),
    ).resolves.toHaveLength(1);
  });
});
