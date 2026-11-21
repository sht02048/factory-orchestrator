import { describe, expect, test } from "vitest";
import { decideProgress, escalationQuestionId, lastOutputOf } from "./progress.js";
import type { ProgressInput } from "./progress.js";
import {
  checkResultSchema,
  terminalShowResultSchema,
  workerShowResultSchema,
  worktreePsResultSchema,
} from "./schemas.js";
import { peekOf, research } from "./test-support.js";

function worker(file: string): ProgressInput["worker"] {
  const parsed: unknown = JSON.parse(research(`0008/${file}`));
  if (typeof parsed !== "object" || parsed === null || !("result" in parsed)) throw new Error();
  return workerShowResultSchema.parse(parsed.result);
}

function mails(...files: string[]): ProgressInput["mails"] {
  const parsed: unknown = JSON.parse(peekOf(...files.map((f) => research(`0008/${f}`))));
  if (typeof parsed !== "object" || parsed === null || !("result" in parsed)) throw new Error();
  return checkResultSchema.parse(parsed.result).messages;
}

const r2 = {
  dispatchId: "ctx_000000000002",
  taskResult: null,
  worker: worker("worker-show-agent-exited-shell-live.json"),
  worktreeRow: "unknown",
  worktreeExists: true,
} satisfies Omit<ProgressInput, "mails">;

describe("decideProgress", () => {
  test("an open permission prompt is a permission wait to deny", () => {
    const progress = decideProgress({
      ...r2,
      worker: { ...r2.worker, liveness: "live" },
      mails: mails("escalation-needs-input-full.json"),
    });
    expect(progress).toEqual({
      kind: "active",
      activity: { kind: "unknown" },
      unreportedStop: null,
      questions: [],
      permissionWaits: [
        {
          id: "apr_0000000000000001",
          detail: "Allow Bash?: touch perm-test.txt",
          requestedAt: new Date("2026-11-17T14:09:37Z"),
        },
      ],
    });
  });

  test("an answered permission prompt is no longer waiting", () => {
    const progress = decideProgress({
      ...r2,
      worker: { ...r2.worker, liveness: "live" },
      mails: mails("escalation-needs-input-full.json", "status-approval-answered-full.json"),
    });
    expect(progress).toEqual({
      kind: "active",
      questions: [],
      permissionWaits: [],
      activity: { kind: "unknown" },
      unreportedStop: null,
    });
  });

  test("mail for another run is ignored", () => {
    const progress = decideProgress({
      ...r2,
      dispatchId: "ctx_000000000001",
      worker: { ...r2.worker, liveness: "live" },
      mails: mails("escalation-needs-input-full.json", "escalation-lost-full.json"),
    });
    expect(progress).toEqual({
      kind: "active",
      questions: [],
      permissionWaits: [],
      activity: { kind: "unknown" },
      unreportedStop: null,
    });
  });

  test("an agent that died and left only its shell is ended without report", () => {
    const progress = decideProgress({
      ...r2,
      dispatchId: "ctx_000000000003",
      mails: [],
      worktreeRow: {
        worktreeId: "10000000-0000-4000-8000-000000000004::<path>/workspaces/sandbox/fo-orch-r3",
        liveTerminalCount: 1,
        agents: [],
      },
    });
    expect(progress).toEqual({
      kind: "ended-without-report",
      detail: "agent exited and only its shell is left in the worktree",
    });
  });

  test("an unverifiable agent still listed in the worktree is still running", () => {
    const progress = decideProgress({
      ...r2,
      dispatchId: "ctx_000000000003",
      mails: [],
      worktreeRow: {
        worktreeId: "10000000-0000-4000-8000-000000000004::<path>/workspaces/sandbox/fo-orch-r3",
        liveTerminalCount: 1,
        agents: [{ state: "working" }],
      },
    });
    expect(progress.kind).toBe("active");
  });

  test("a stopped agent is ended without report", () => {
    expect(
      decideProgress({
        ...r2,
        worker: worker("worker-show-after-stop.json"),
        mails: [],
      }),
    ).toEqual({ kind: "ended-without-report", detail: "agent exited: process_stopped" });
  });

  test("a report wins over every other signal; an unknown outcome is passed on", () => {
    const progress = decideProgress({
      ...r2,
      worker: worker("worker-show-lost.json"),
      taskResult: JSON.stringify({ provenance: "worker_report", outcome: "partial", body: "b" }),
      mails: mails("escalation-lost-full.json"),
      worktreeExists: false,
    });
    expect(progress).toEqual({
      kind: "reported",
      report: { outcome: "partial", body: "b", reportedAt: null },
    });
  });

  test("reads this run's decision_gate as a Human Check and ignores another dispatch's", () => {
    const gate = (id: string, dispatchId: string) => ({
      id,
      type: "decision_gate",
      subject: "PR #1 머지를 확인해 주세요",
      body: "https://github.com/acme/widgets/pull/1",
      payload: JSON.stringify({ dispatchId }),
      created_at: "2026-11-21T01:28:02Z",
    });
    const progress = decideProgress({
      ...r2,
      dispatchId: "ctx_mine",
      worker: { ...r2.worker, liveness: "live" },
      mails: [gate("msg_mine", "ctx_mine"), gate("msg_other", "ctx_other")],
    });
    if (progress.kind !== "active") throw new Error(progress.kind);
    expect(progress.questions).toEqual([
      {
        id: "msg_mine",
        kind: "human-check",
        body: "PR #1 머지를 확인해 주세요\n\nhttps://github.com/acme/widgets/pull/1",
        options: [],
        askedAt: new Date("2026-11-21T01:28:02Z"),
      },
    ]);
  });

  test("a Task result that is not a worker report is not a report", () => {
    const progress = decideProgress({
      ...r2,
      worker: { ...r2.worker, liveness: "live" },
      taskResult: JSON.stringify({ provenance: "coordinator", outcome: "succeeded" }),
      mails: [],
    });
    expect(progress.kind).toBe("active");
  });
});

function envelope(file: string): unknown {
  const parsed: unknown = JSON.parse(research(file));
  if (typeof parsed !== "object" || parsed === null || !("result" in parsed)) throw new Error();
  return parsed.result;
}

function psRow(file: string): ProgressInput["worktreeRow"] {
  const row = worktreePsResultSchema.parse(envelope(`0120/${file}`)).worktrees[0];
  if (row === undefined) throw new Error(`no worktree row in ${file}`);
  return row;
}

function mails0120(...files: string[]): ProgressInput["mails"] {
  const parsed: unknown = JSON.parse(peekOf(...files.map((f) => research(`0120/${f}`))));
  if (typeof parsed !== "object" || parsed === null || !("result" in parsed)) throw new Error();
  return checkResultSchema.parse(parsed.result).messages;
}

const runnerStopRun = {
  dispatchId: "ctx_000000000120",
  taskResult: null,
  worker: workerShowResultSchema.parse(envelope("0120/worker-show-unverifiable-retained.json")),
  mails: [],
  worktreeRow: psRow("worktree-ps-agent-working.json"),
  worktreeExists: true,
} satisfies ProgressInput;

describe("decideProgress: 러너에서 멈춘·막힌 에이전트(0120)", () => {
  test("러너에서 중단된 에이전트 세션은 interrupted로 알린다", () => {
    const progress = decideProgress({
      ...runnerStopRun,
      worktreeRow: psRow("worktree-ps-agent-interrupted.json"),
    });
    expect(progress).toMatchObject({
      kind: "active",
      activity: { kind: "interrupted", since: new Date(1795084992430) },
      unreportedStop: null,
    });
  });

  test("Orca의 '보고 없이 멈춤' 알림은 마지막 출력과 함께 알리고 질문으로 만들지 않는다", () => {
    const progress = decideProgress({
      ...runnerStopRun,
      worktreeRow: psRow("worktree-ps-agent-turn-ended.json"),
      mails: mails0120("escalation-stop-finished-full.json"),
    });
    expect(progress).toMatchObject({
      kind: "active",
      questions: [],
      activity: { kind: "turn-ended", since: new Date(1795084924263) },
      unreportedStop: {
        at: new Date("2026-11-19T10:42:05Z"),
        lastOutput: [
          "로그인 버튼 색을 고쳤어요. 시험은 아직 돌리지 못했어요.",
          "",
          "- `src/login.tsx` 를 바꿨어요.",
          "❯",
        ],
      },
    });
  });

  test("오류로 턴을 끝낸 알림(errored)도 보고 없이 멈춘 것이다", () => {
    const progress = decideProgress({
      ...runnerStopRun,
      mails: mails0120("escalation-stop-errored-full.json"),
    });
    expect(progress).toMatchObject({
      kind: "active",
      unreportedStop: { at: new Date("2026-11-19T03:30:27Z") },
    });
  });

  test("이유 칸(stopReason)이 없는 옛 Orca의 알림은 msg_stop_ id로 알아본다", () => {
    const [stop] = mails0120("escalation-stop-finished-full.json");
    if (stop === undefined) throw new Error();
    const progress = decideProgress({
      ...runnerStopRun,
      mails: [
        {
          ...stop,
          payload: JSON.stringify({ taskId: "task_000000000120", dispatchId: "ctx_000000000120" }),
        },
      ],
    });
    expect(progress).toMatchObject({
      kind: "active",
      questions: [],
      unreportedStop: { at: new Date("2026-11-19T10:42:05Z") },
    });
  });

  test("에이전트가 막혔다고 보낸 escalation은 그 본문을 질문으로 만든다", () => {
    const progress = decideProgress({
      ...runnerStopRun,
      worktreeRow: psRow("worktree-ps-agent-turn-ended.json"),
      mails: mails0120("escalation-blocked-full.json", "escalation-stop-finished-full.json"),
    });
    expect(progress).toMatchObject({
      kind: "active",
      questions: [
        {
          id: escalationQuestionId("msg_000000000122"),
          body: "로그인 화면은 디자인 시안이 정해져야 고칠 수 있다. 시안 링크를 알려 주면 그 위에서 이어 하겠다.",
          options: [],
          askedAt: new Date("2026-11-19T10:41:59Z"),
        },
      ],
    });
  });

  test("끝난 에이전트에게 메일을 전하지 못했다는 Orca 알림은 질문이 아니라 보고 없이 멈춘 것이다", () => {
    const progress = decideProgress({
      ...runnerStopRun,
      mails: mails0120("escalation-followup-full.json"),
    });
    expect(progress).toMatchObject({
      kind: "active",
      questions: [],
      unreportedStop: { at: new Date("2026-11-18T13:25:10Z"), lastOutput: [] },
    });
  });

  test("본 차례는 끝났어도 뒤에서 셸이 도는 에이전트는 working이다", () => {
    expect(
      decideProgress({
        ...runnerStopRun,
        worktreeRow: psRow("worktree-ps-agent-background-shell.json"),
      }),
    ).toMatchObject({ activity: { kind: "working", since: new Date(1795096571496) } });
  });

  test("다시 일하는 에이전트는 working으로 알린다", () => {
    expect(decideProgress(runnerStopRun)).toMatchObject({
      kind: "active",
      activity: { kind: "working" },
    });
  });

  test("에이전트 행이 여럿이면 런의 터미널 칸(paneKey)으로 고르고, 고를 수 없으면 모른다", () => {
    const two = psRow("worktree-ps-two-agents.json");
    const terminal = terminalShowResultSchema.parse(envelope("0120/terminal-show.json")).terminal;
    expect(
      decideProgress({
        ...runnerStopRun,
        worktreeRow: two,
        agentPaneKey: `${terminal.tabId ?? ""}:${terminal.leafId ?? ""}`,
      }),
    ).toMatchObject({ activity: { kind: "interrupted" } });
    expect(decideProgress({ ...runnerStopRun, worktreeRow: two })).toMatchObject({
      activity: { kind: "unknown" },
    });
  });

  test("모르는 형식의 에이전트 행이나 행이 없으면 모르는 상태로 둔다", () => {
    expect(
      decideProgress({
        ...runnerStopRun,
        worktreeRow: {
          worktreeId: "w",
          agents: [{ state: "sleeping", stateStartedAt: 1795084992430 }],
        },
      }),
    ).toMatchObject({ activity: { kind: "unknown" } });
    expect(decideProgress({ ...runnerStopRun, worktreeRow: "unknown" })).toMatchObject({
      activity: { kind: "unknown" },
    });
    expect(
      decideProgress({ ...runnerStopRun, worktreeRow: { worktreeId: "w", agents: [{}] } }),
    ).toMatchObject({ activity: { kind: "unknown" } });
  });
});

describe("lastOutputOf", () => {
  test("'Last output:' 다음 줄부터 'Full output:' 앞까지를 마지막 출력으로 본다", () => {
    expect(
      lastOutputOf("head\nLast output:\na\nb\nFull output: orchestration worker-read"),
    ).toEqual(["a", "b"]);
    expect(lastOutputOf("no output here")).toEqual([]);
    expect(lastOutputOf(null)).toEqual([]);
  });
});
