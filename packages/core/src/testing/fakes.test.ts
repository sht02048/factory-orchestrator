import { describe, expect, it } from "vitest";

import { AdapterError, blockedProjectsOf, isAssignmentBlocked } from "../adapters.js";
import type { CodeHost, PullRequestSnapshot, Runner, Tracker } from "../adapters.js";
import {
  toAgentId,
  toLabelId,
  toPullRequestId,
  toRepoRef,
  toRunnerProjectId,
  toTicketKey,
  toTrackerProjectId,
  toTrackerStateId,
} from "../ids.js";
import type { PermissionRequestId, QuestionId } from "../ids.js";
import { resolveRunProgress } from "../timing.js";
import { FakeCodeHost, FakeRunner, FakeTracker } from "./index.js";

const _tracker: Tracker = new FakeTracker();
const _runner: Runner = new FakeRunner();
const _codeHost: CodeHost = new FakeCodeHost();

const app = toRunnerProjectId("fake:acme/app");
const project = { id: app, displayName: "app", setupState: "ready" };

const handled = (answered: QuestionId[] = [], denied: PermissionRequestId[] = []) => ({
  answered: new Set(answered),
  denied: new Set(denied),
});

async function startOne(runner: FakeRunner, worktreeName = "ganger-ENG-1-1") {
  const mailbox = await runner.ensureMailbox(null);
  const started = await runner.startRun({
    mailbox,
    project: app,
    worktreeName,
    agent: toAgentId("claude"),
    brief: "티켓 본문",
  });
  return { mailbox, started, run: { mailbox, ...started } };
}

describe("FakeRunner", () => {
  it("따로 정하지 않으면 Online이고 테스트가 넣은 러너 쪽 프로젝트를 가진다고 답한다", async () => {
    const runner = new FakeRunner();
    runner.setProjects([project]);

    const health = await runner.checkHealth();
    expect(health).toMatchObject({ online: true, error: null });
    expect(isAssignmentBlocked(health)).toBe(false);
    await expect(runner.listProjects()).resolves.toEqual([project]);
  });

  it("push 인증 항목이 깨지면 Online이어도 할당을 막는다 (Q82.14)", async () => {
    const runner = new FakeRunner();
    runner.prerequisites = runner.prerequisites.map((p) =>
      p.blocksAssignment ? { ...p, satisfied: false } : p,
    );

    const health = await runner.checkHealth();
    expect(health.online).toBe(true);
    expect(isAssignmentBlocked(health)).toBe(true);
  });

  it("프로젝트에 걸린 항목이 깨지면 러너가 아니라 그 프로젝트만 막는다 (0096)", () => {
    const prerequisites = [
      {
        id: "github-push:app",
        name: "push",
        satisfied: false,
        hint: null,
        blocksAssignment: true,
        project: project.id,
      },
    ];

    expect(isAssignmentBlocked({ prerequisites })).toBe(false);
    expect(blockedProjectsOf(prerequisites)).toEqual([project.id]);
    expect(blockedProjectsOf([{ ...prerequisites[0], satisfied: null }])).toEqual([]);
  });

  it("우편함은 살아 있으면 그대로 돌려주고, 사라지면 다시 만든다 (Q82.1)", async () => {
    const runner = new FakeRunner();
    const first = await runner.ensureMailbox(null);

    await expect(runner.ensureMailbox(first)).resolves.toBe(first);
    runner.dropMailbox(first);
    const second = await runner.ensureMailbox(first);
    expect(second).not.toBe(first);
  });

  it("사라진 우편함으로 시작하면 mailbox-missing으로 실패한다", async () => {
    const runner = new FakeRunner();
    runner.setProjects([project]);
    const mailbox = await runner.ensureMailbox(null);
    runner.dropMailbox(mailbox);

    const error = await runner
      .startRun({ mailbox, project: app, worktreeName: "w", agent: toAgentId("a"), brief: "p" })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ detail: { kind: "mailbox-missing" } });
  });

  it("시작하면 러너가 정한 실제 브랜치와 에이전트 참조를 돌려준다 (Q82.6)", async () => {
    const runner = new FakeRunner();
    runner.setProjects([project]);
    const { started } = await startOne(runner);

    expect(started.branch).toBe("fake/ganger-ENG-1-1");
    expect(started.agentRef).toBeTruthy();
  });

  it("시작 멱등: 같은 워크트리 이름은 다시 시작하지 않고 findStartedRun으로 이어 붙인다", async () => {
    const runner = new FakeRunner();
    runner.setProjects([project]);
    runner.loseNextStartResponse = true;
    const mailbox = await runner.ensureMailbox(null);
    const input = {
      mailbox,
      project: app,
      worktreeName: "ganger-ENG-1-1",
      agent: toAgentId("a"),
      brief: "p",
    };

    const lost = await runner.startRun(input).catch((e: unknown) => e);
    expect(lost).toMatchObject({ detail: { kind: "start-outcome-unknown" } });
    const found = await runner.findStartedRun({ mailbox, worktreeName: input.worktreeName });
    expect(found).not.toBeNull();
    const again = await runner.startRun(input).catch((e: unknown) => e);
    expect(again).toMatchObject({ detail: { kind: "runner-error", code: "worktree_exists" } });
    await expect(runner.findStartedRun({ mailbox, worktreeName: "other" })).resolves.toBeNull();
  });

  it("테스트가 정한 오류로 시작을 한 번 실패시킨다", async () => {
    const runner = new FakeRunner();
    runner.setProjects([project]);
    runner.failNextStart = { kind: "runner-error", code: "boom", message: "boom" };

    const error = await startOne(runner).catch((e: unknown) => e);
    expect(error).toMatchObject({ detail: { kind: "runner-error", code: "boom" } });
    await expect(startOne(runner)).resolves.toBeTruthy();
    expect(runner.startCalls).toHaveLength(2);
  });

  it("질문 → 답하기: 질문은 답한 뒤에도 남고, DB에 답했다고 기록하면 Running으로 본다 (Q82.3·Q82.5)", async () => {
    const runner = new FakeRunner();
    runner.setProjects([project]);
    const { run, started } = await startOne(runner);

    const id = runner.ask(started.worktree, { body: "A와 B 중 무엇?", options: ["A", "B"] });
    const asked = await runner.pollRun(run);
    expect(asked).toMatchObject({
      kind: "active",
      questions: [{ id, body: "A와 B 중 무엇?", options: ["A", "B"] }],
    });
    expect(resolveRunProgress(asked, handled())).toMatchObject({ state: "waiting-for-input" });

    await runner.answerQuestion(run, { questionId: id, answer: "A" });
    expect(runner.runAt(started.worktree).answers).toEqual([{ questionId: id, answer: "A" }]);
    const after = await runner.pollRun(run);
    expect(after).toMatchObject({ kind: "active", questions: [{ id }] });
    expect(resolveRunProgress(after, handled([id]))).toEqual({
      kind: "continue",
      state: "running",
    });
  });

  it("권한 대기 → 거절: 거절하면 대기가 닫힌다. 허용은 러너 화면에서만 한다 (Q82.4)", async () => {
    const runner = new FakeRunner();
    runner.setProjects([project]);
    const { run, started } = await startOne(runner);

    const id = runner.requestPermission(started.worktree, "Bash(touch x)");
    const waiting = await runner.pollRun(run);
    expect(resolveRunProgress(waiting, handled())).toMatchObject({
      state: "waiting-for-input",
      permissionWaits: [id],
    });

    await runner.denyPermission(run, { permissionId: id, reason: "운영자가 거절했어요" });
    expect(runner.runAt(started.worktree).denials).toHaveLength(1);
    expect(resolveRunProgress(await runner.pollRun(run), handled())).toEqual({
      kind: "continue",
      state: "running",
    });
  });

  it.each([
    ["succeeded", "reported-success"],
    ["failed", "reported-failure"],
  ] as const)(
    "완료 보고(%s) → %s 로 끝나고, 보고 뒤에도 살아 있는 에이전트를 닫을 수 있다 (Q82.2·Q82.19)",
    async (outcome, agentResult) => {
      const runner = new FakeRunner();
      runner.setProjects([project]);
      const { run, started } = await startOne(runner);

      runner.report(started.worktree, { outcome, body: "PR을 열었어요" });
      const progress = await runner.pollRun(run);
      expect(progress).toEqual({
        kind: "reported",
        report: { outcome, body: "PR을 열었어요", reportedAt: null },
      });
      expect(resolveRunProgress(progress, handled())).toMatchObject({ kind: "end", agentResult });

      await runner.closeAgent(run);
      expect(runner.runAt(started.worktree).agentClosed).toBe(true);
    },
  );

  it("보고 없이 사라짐 → 비정상 종료 (Q82.19)", async () => {
    const runner = new FakeRunner();
    runner.setProjects([project]);
    const { run, started } = await startOne(runner);

    runner.vanish(started.worktree);
    const progress = await runner.pollRun(run);
    expect(progress).toMatchObject({ kind: "ended-without-report" });
    expect(resolveRunProgress(progress, handled())).toMatchObject({
      kind: "end",
      agentResult: "ended-without-report",
    });
  });

  it("멈춘 에이전트와 지운 워크트리를 돌려준다", async () => {
    const runner = new FakeRunner();
    runner.setProjects([project]);
    const { run, started } = await startOne(runner);

    await runner.stopAgent(run);
    expect(runner.runAt(started.worktree).agentStopped).toBe(true);
    await runner.removeWorktree(started.worktree);
    expect(runner.removed).toEqual([started.worktree]);
    await expect(runner.worktreeExists(started.worktree)).resolves.toBe(false);
    await expect(runner.pollRun(run)).resolves.toEqual({ kind: "worktree-gone" });
  });

  it("로그 꼬리는 요청한 줄 수만큼 돌려주고 0줄이면 비어 있다", async () => {
    const runner = new FakeRunner();
    runner.setProjects([project]);
    const { run, started } = await startOne(runner);
    runner.appendLog(started.worktree, "1", "2", "3");

    await expect(runner.readLogTail(run, { lines: 2 })).resolves.toEqual(["2", "3"]);
    await expect(runner.readLogTail(run, { lines: 0 })).resolves.toEqual([]);
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
    id: toPullRequestId("pr-7"),
    displayId: "#7",
    url: "https://example.com/acme/app/pull/7",
    title: "ENG-1 고치기",
    body: "",
    state: "open",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    mergedAt: null,
    headBranch: "factory/ENG-1-1",
    sourceRepo: repo,
    headCommit: "abc",
    baseBranch: "main",
    ci: "pending",
  };

  it("러너 쪽 프로젝트에서 저장소를 읽고, 브랜치·티켓 키·번호로 넣은 PR을 찾는다", async () => {
    const codeHost = new FakeCodeHost();
    codeHost.putPullRequest(repo, pr);

    expect(codeHost.repoOf(app)).toBe(repo);
    expect(codeHost.repoOf(toRunnerProjectId("other:acme/app"))).toBeNull();
    await expect(codeHost.findPullRequestsByBranch(repo, pr.headBranch)).resolves.toEqual([pr]);
    const since = (iso: string) => ({ createdSince: new Date(iso) });
    await expect(
      codeHost.findPullRequestsByTicketKey(
        repo,
        toTicketKey("ENG-1"),
        since("2025-12-31T00:00:00Z"),
      ),
    ).resolves.toEqual([pr]);
    await expect(
      codeHost.findPullRequestsByTicketKey(
        repo,
        toTicketKey("ENG-1"),
        since("2026-01-02T00:00:00Z"),
      ),
    ).resolves.toEqual([]);
    await expect(
      codeHost.findPullRequestsByTicketKey(
        repo,
        toTicketKey("ENG-12"),
        since("2025-01-01T00:00:00Z"),
      ),
    ).resolves.toEqual([]);
    await expect(codeHost.getPullRequest(repo, toPullRequestId("pr-7"))).resolves.toEqual(pr);
    await expect(codeHost.getPullRequest(repo, toPullRequestId("pr-8"))).resolves.toBeNull();
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
