import { AdapterError, toAgentMessageRequestId, toFollowUpRef, toQuestionId } from "@ganger/core";
import type { RunnerErrorDetail, RunnerId, WorktreeRef } from "@ganger/core";
import {
  changeRunState,
  getRun,
  listRunAgentMessages,
  listRunners,
  markAgentMessageSending,
  requestAgentMessage,
  requestRunCancel,
  requestRunControl,
  runTimeline,
} from "@ganger/db";
import type { StoredRun } from "@ganger/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FOLLOW_UP_STOP_RETRY_MS } from "./agent-messages.js";
import { Harness, projectA } from "./test-fixtures.js";
import type { Worker } from "./worker.js";

let h: Harness;

beforeEach(() => {
  h = new Harness();
});

afterEach(async () => {
  await h.cleanup();
});

function stateOf(run: StoredRun): string | undefined {
  return getRun(h.db, run.id)?.state;
}

function worktreeOf(run: StoredRun): WorktreeRef {
  const found = getRun(h.db, run.id);
  if (found === null || found.state === "queued" || found.worktree === null) {
    throw new Error("run has not started");
  }
  return found.worktree;
}

async function startOne(): Promise<{ run: StoredRun; runnerId: RunnerId; worker: Worker }> {
  const runnerId = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
  const run = h.assign("ENG-1", projectA);
  const worker = h.worker();
  await worker.tick();
  expect(stateOf(run)).toBe("running");
  return { run, runnerId, worker };
}

function sentTo(run: StoredRun, runnerId: RunnerId): string[] {
  return h.runner(runnerId).runAt(worktreeOf(run)).agentMessages;
}

function findStoredMailbox(runnerId: RunnerId) {
  return listRunners(h.db).find((runner) => runner.id === runnerId)?.mailbox ?? null;
}

function only(run: StoredRun) {
  const [message] = listRunAgentMessages(h.db, run.id);
  if (message === undefined) throw new Error("no message");
  return message;
}

describe("에이전트에게 보내기(0147)", () => {
  it("Running 런의 말을 러너로 보내고 완료로 적으며 상태는 그대로다", async () => {
    const { run, runnerId, worker } = await startOne();
    expect(
      requestAgentMessage(
        h.db,
        run.id,
        { requestId: toAgentMessageRequestId("request-1"), body: "push 해 주세요" },
        h.now,
      ),
    ).toMatchObject({ ok: true });
    await worker.tick();
    expect(sentTo(run, runnerId)).toEqual(["push 해 주세요"]);
    expect(only(run)).toMatchObject({ error: null });
    expect(only(run).completedAt).not.toBeNull();
    expect(stateOf(run)).toBe("running");
    await worker.tick();
    expect(sentTo(run, runnerId)).toHaveLength(1);
  });

  it("Waiting for Input 런에는 바로 보내되 질문은 열어 두고 상태도 그대로다", async () => {
    const { run, runnerId, worker } = await startOne();
    const agent = h.runner(runnerId).runAt(worktreeOf(run));
    const question = { id: toQuestionId("q-1"), body: "어느 쪽?", options: [], askedAt: h.now };
    agent.questions.push(question);
    agent.activity = { kind: "unknown" };
    await worker.tick();
    expect(stateOf(run)).toBe("waiting-for-input");

    requestAgentMessage(
      h.db,
      run.id,
      { requestId: toAgentMessageRequestId("request-2"), body: "참고로 main 기준이에요" },
      h.now,
    );
    await worker.tick();
    expect(agent.agentMessages).toEqual(["참고로 main 기준이에요"]);
    expect(agent.answers).toEqual([]);
    expect(stateOf(run)).toBe("waiting-for-input");
  });

  it("Paused 런의 말은 재개 전에 보내지 않고, 재개한 직후 보낸다", async () => {
    const { run, runnerId, worker } = await startOne();
    requestRunControl(h.db, run.id, "pause", h.now);
    await worker.tick();
    expect(stateOf(run)).toBe("paused");

    requestAgentMessage(
      h.db,
      run.id,
      { requestId: toAgentMessageRequestId("request-3"), body: "재개하면 PR 까지" },
      h.now,
    );
    await worker.tick();
    await worker.tick();
    expect(sentTo(run, runnerId)).toEqual([]);
    expect(only(run).completedAt).toBeNull();
    expect(stateOf(run)).toBe("paused");

    requestRunControl(h.db, run.id, "resume", h.now);
    await worker.tick();
    expect(stateOf(run)).toBe("running");
    expect(sentTo(run, runnerId)).toEqual(["재개하면 PR 까지"]);
    expect(only(run).error).toBeNull();
  });

  it("맡아 둔 말은 런이 취소되면 보내지 않고 이유를 남긴다", async () => {
    const { run, runnerId, worker } = await startOne();
    const agent = h.runner(runnerId).runAt(worktreeOf(run));
    requestRunControl(h.db, run.id, "pause", h.now);
    await worker.tick();
    requestAgentMessage(
      h.db,
      run.id,
      { requestId: toAgentMessageRequestId("request-4"), body: "보내면 안 돼요" },
      h.now,
    );
    requestRunCancel(h.db, run.id, h.now);
    await worker.tick();
    expect(agent.agentMessages).toEqual([]);
    expect(only(run).error).toBe("state-changed");
  });

  it("러너가 거절하면 이유를 적고 다시 보내지 않는다", async () => {
    const { run, runnerId, worker } = await startOne();
    const failure: RunnerErrorDetail = {
      kind: "runner-error",
      code: "agent_not_running",
      message: "gone",
    };
    h.runner(runnerId).failNextControl = failure;
    requestAgentMessage(
      h.db,
      run.id,
      { requestId: toAgentMessageRequestId("request-5"), body: "안 닿는 말" },
      h.now,
    );
    await worker.tick();
    expect(only(run).error).toBe("agent-not-running");
    await worker.tick();
    expect(sentTo(run, runnerId)).toEqual([]);
  });

  it.each<[string, RunnerErrorDetail]>([
    ["ssh 응답이 끊기면", { kind: "unreachable", detail: "ssh timed out" }],
    ["출력을 읽지 못하면", { kind: "malformed-output", raw: "not json" }],
  ])("%s 전해졌는지 모른다고 남기고 다시 보내지 않는다", async (_name, failure) => {
    const { run, runnerId, worker } = await startOne();
    h.runner(runnerId).failNextControl = failure;
    requestAgentMessage(
      h.db,
      run.id,
      { requestId: toAgentMessageRequestId("request-6"), body: "한 번만" },
      h.now,
    );
    await worker.tick();
    expect(only(run).error).toBe("outcome-unknown");
    await worker.tick();
    expect(sentTo(run, runnerId)).toEqual([]);
  });

  it("틱 도중 들어온 멈추기 요청이 있으면 말을 보내지 않고 재개 뒤로 미룬다", async () => {
    const { run, runnerId, worker } = await startOne();
    const fake = h.runner(runnerId);
    const agent = fake.runAt(worktreeOf(run));
    const poll = fake.pollRun.bind(fake);
    vi.spyOn(fake, "pollRun").mockImplementationOnce((onRunner) => {
      requestRunControl(h.db, run.id, "pause", h.now);
      return poll(onRunner);
    });
    requestAgentMessage(
      h.db,
      run.id,
      { requestId: toAgentMessageRequestId("request-7"), body: "멈춘 뒤에 갈 말" },
      h.now,
    );
    await worker.tick();
    expect(agent.agentMessages).toEqual([]);
    await worker.tick();
    expect(stateOf(run)).toBe("paused");
    expect(agent.agentMessages).toEqual([]);
    requestRunControl(h.db, run.id, "resume", h.now);
    await worker.tick();
    expect(agent.agentMessages).toEqual(["멈춘 뒤에 갈 말"]);
  });

  it("메일함이 없어졌으면 저장한 메일함을 지워 다음 보내기에서 다시 만든다", async () => {
    const { run, runnerId, worker } = await startOne();
    expect(findStoredMailbox(runnerId)).not.toBeNull();
    h.runner(runnerId).failNextControl = { kind: "mailbox-missing", detail: "gone" };
    requestAgentMessage(
      h.db,
      run.id,
      { requestId: toAgentMessageRequestId("request-8"), body: "안 닿는 말" },
      h.now,
    );
    const ensure = vi.spyOn(h.runner(runnerId), "ensureMailbox");
    await worker.tick();
    expect(only(run).error).toBe("runner-error");
    ensure.mockClear();
    await worker.tick();
    expect(ensure.mock.calls[0]?.[0]).toBeNull();
  });

  it("런을 읽은 뒤 보내기 직전에 에이전트가 끝났으면 보내지 않는다", async () => {
    const { run, runnerId, worker } = await startOne();
    const fake = h.runner(runnerId);
    const agent = fake.runAt(worktreeOf(run));
    const poll = fake.pollRun.bind(fake);
    vi.spyOn(fake, "pollRun").mockImplementationOnce(async (onRunner) => {
      const progress = await poll(onRunner);
      agent.report = { outcome: "succeeded", body: "끝났어요", reportedAt: h.now };
      return progress;
    });
    requestAgentMessage(
      h.db,
      run.id,
      { requestId: toAgentMessageRequestId("late"), body: "늦은 말" },
      h.now,
    );
    await worker.tick();
    expect(agent.agentMessages).toEqual([]);
    expect(only(run).error).toBe("state-changed");
  });

  it("완료 보고를 받은 틱에는 끝난 에이전트에게 보내지 않는다", async () => {
    const { run, runnerId, worker } = await startOne();
    const agent = h.runner(runnerId).runAt(worktreeOf(run));
    agent.report = { outcome: "succeeded", body: "끝났어요", reportedAt: h.now };
    requestAgentMessage(
      h.db,
      run.id,
      { requestId: toAgentMessageRequestId("request-9"), body: "늦은 말" },
      h.now,
    );
    await worker.tick();
    expect(stateOf(run)).toBe("ended");
    expect(agent.agentMessages).toEqual([]);
    expect(only(run).error).toBe("state-changed");
  });

  it("보내기 시작만 적히고 끝나지 않은 말은 두 번 보내지 않고 확인하지 못했다고 남긴다", async () => {
    const { run, runnerId, worker } = await startOne();
    const sent = requestAgentMessage(
      h.db,
      run.id,
      { requestId: toAgentMessageRequestId("request-10"), body: "한 번만" },
      h.now,
    );
    if (!sent.ok) throw new Error("not requested");
    expect(markAgentMessageSending(h.db, sent.id, h.now)).toBe(true);
    await worker.tick();
    expect(sentTo(run, runnerId)).toEqual([]);
    expect(only(run).error).toBe("outcome-unknown");
  });

  it("같은 요청 ID로 다시 보내면 한 번만 저장하고 한 번만 전한다", async () => {
    const { run, runnerId, worker } = await startOne();
    const input = { requestId: toAgentMessageRequestId("retried-request"), body: "한 번만 갈 말" };
    const first = requestAgentMessage(h.db, run.id, input, h.now);
    const second = requestAgentMessage(h.db, run.id, input, h.now);
    expect(second).toEqual(first);
    await worker.tick();
    expect(requestAgentMessage(h.db, run.id, input, h.now)).toEqual(first);
    await worker.tick();
    expect(listRunAgentMessages(h.db, run.id)).toHaveLength(1);
    expect(sentTo(run, runnerId)).toEqual(["한 번만 갈 말"]);
  });

  it("끝난 에이전트에게 간 말로 후속 워커가 뜨면 멈추고 전해졌을 수 있다고 남긴다", async () => {
    const { run, runnerId, worker } = await startOne();
    const fake = h.runner(runnerId);
    fake.nextSendStartsFollowUp = toFollowUpRef("ctx_follow_up");
    requestAgentMessage(
      h.db,
      run.id,
      { requestId: toAgentMessageRequestId("follow-up"), body: "말" },
      h.now,
    );
    await worker.tick();
    expect(fake.stoppedFollowUps).toEqual([toFollowUpRef("ctx_follow_up")]);
    expect(only(run).error).toBe("follow-up-stopped");
  });

  it("후속 워커를 멈추지 못하면 러너에 닿을 때까지 다시 시도하고 말은 다시 보내지 않는다", async () => {
    const { run, runnerId, worker } = await startOne();
    const fake = h.runner(runnerId);
    const agent = fake.runAt(worktreeOf(run));
    fake.nextSendStartsFollowUp = toFollowUpRef("ctx_follow_up");
    vi.spyOn(fake, "stopFollowUp").mockImplementationOnce(() =>
      Promise.reject(new AdapterError<RunnerErrorDetail>({ kind: "unreachable", detail: "ssh" })),
    );
    requestAgentMessage(
      h.db,
      run.id,
      { requestId: toAgentMessageRequestId("retry-stop"), body: "말" },
      h.now,
    );
    await worker.tick();
    expect(only(run).completedAt).toBeNull();
    expect(fake.stoppedFollowUps).toEqual([]);
    await worker.tick();
    expect(fake.stoppedFollowUps).toEqual([toFollowUpRef("ctx_follow_up")]);
    expect(only(run).error).toBe("follow-up-stopped");
    expect(agent.agentMessages).toEqual(["말"]);
  });

  it("후속 워커를 한 시간 동안 멈추지 못하면 멈추지 못했다고 끝낸다", async () => {
    const { run, runnerId, worker } = await startOne();
    const fake = h.runner(runnerId);
    fake.nextSendStartsFollowUp = toFollowUpRef("ctx_follow_up");
    vi.spyOn(fake, "stopFollowUp").mockRejectedValue(
      new AdapterError<RunnerErrorDetail>({ kind: "unreachable", detail: "ssh" }),
    );
    requestAgentMessage(
      h.db,
      run.id,
      { requestId: toAgentMessageRequestId("stop-deadline"), body: "말" },
      h.now,
    );
    await worker.tick();
    expect(only(run).completedAt).toBeNull();
    h.advance(FOLLOW_UP_STOP_RETRY_MS);
    await worker.tick();
    expect(only(run).error).toBe("follow-up-not-stopped");
  });

  it("후속 워커를 멈출 수 없다고 확정되면 멈추지 못했다고 남긴다", async () => {
    const { run, runnerId, worker } = await startOne();
    const fake = h.runner(runnerId);
    fake.nextSendStartsFollowUp = toFollowUpRef("ctx_follow_up");
    vi.spyOn(fake, "stopFollowUp").mockRejectedValueOnce(
      new AdapterError<RunnerErrorDetail>({ kind: "runner-error", code: "x", message: "no" }),
    );
    requestAgentMessage(
      h.db,
      run.id,
      { requestId: toAgentMessageRequestId("stop-fails"), body: "말" },
      h.now,
    );
    await worker.tick();
    expect(only(run).error).toBe("follow-up-not-stopped");
  });

  it("보내기 전에 러너에 닿지 않으면 실패로 끝내지 않고 다음 틱에 보낸다", async () => {
    const { run, runnerId, worker } = await startOne();
    const fake = h.runner(runnerId);
    const agent = fake.runAt(worktreeOf(run));
    fake.online = false;
    requestAgentMessage(
      h.db,
      run.id,
      { requestId: toAgentMessageRequestId("offline"), body: "말" },
      h.now,
    );
    await worker.tick();
    expect(only(run).completedAt).toBeNull();
    fake.online = true;
    await worker.tick();
    expect(agent.agentMessages).toEqual(["말"]);
    expect(only(run).error).toBeNull();
  });

  it("앞선 말이 일시 오류로 남으면 뒤의 말을 먼저 보내지 않는다", async () => {
    const { run, runnerId, worker } = await startOne();
    const fake = h.runner(runnerId);
    const agent = fake.runAt(worktreeOf(run));
    const poll = fake.pollRun.bind(fake);
    let calls = 0;
    vi.spyOn(fake, "pollRun").mockImplementation((onRunner) => {
      calls += 1;
      return calls === 2
        ? Promise.reject(
            new AdapterError<RunnerErrorDetail>({ kind: "unreachable", detail: "ssh" }),
          )
        : poll(onRunner);
    });
    for (const body of ["아직 push하지 말아요", "이제 push해 주세요"]) {
      requestAgentMessage(h.db, run.id, { requestId: toAgentMessageRequestId(body), body }, h.now);
    }
    await worker.tick();
    expect(agent.agentMessages).toEqual([]);
    await worker.tick();
    expect(agent.agentMessages).toEqual(["아직 push하지 말아요", "이제 push해 주세요"]);
  });

  it("이미 실패로 끝난 요청 ID로 다시 보내면 새로 저장하지 않고 실패했다고 답한다", async () => {
    const { run, runnerId, worker } = await startOne();
    const input = { requestId: toAgentMessageRequestId("failed-request"), body: "말" };
    h.runner(runnerId).failNextControl = { kind: "runner-error", code: "x", message: "no" };
    requestAgentMessage(h.db, run.id, input, h.now);
    await worker.tick();
    expect(requestAgentMessage(h.db, run.id, input, h.now)).toEqual({
      ok: false,
      reason: "previous-failed",
    });
    expect(listRunAgentMessages(h.db, run.id)).toHaveLength(1);
  });

  it("끝난 런과 취소 중인 런은 요청을 받지 않는다", async () => {
    const { run } = await startOne();
    requestRunCancel(h.db, run.id, h.now);
    expect(
      requestAgentMessage(
        h.db,
        run.id,
        { requestId: toAgentMessageRequestId("request-11"), body: "늦은 말" },
        h.now,
      ),
    ).toEqual({
      ok: false,
      reason: "cancelling",
    });
    changeRunState(h.db, run.id, {
      to: "ended",
      agentResult: "canceled",
      prState: "none",
    });
    expect(
      requestAgentMessage(
        h.db,
        run.id,
        { requestId: toAgentMessageRequestId("request-12"), body: "늦은 말" },
        h.now,
      ),
    ).toEqual({
      ok: false,
      reason: "not-accepting",
    });
  });

  it("진단용 타임라인에는 보낸 말의 본문을 넣지 않는다", async () => {
    const { run, worker } = await startOne();
    requestAgentMessage(
      h.db,
      run.id,
      { requestId: toAgentMessageRequestId("request-13"), body: "비밀스러운 본문" },
      h.now,
    );
    await worker.tick();
    const entries = runTimeline(h.db, run.id)?.entries ?? [];
    expect(entries.filter((entry) => entry.source === "agent-message").map((e) => e.event)).toEqual(
      ["requested", "sent"],
    );
    expect(JSON.stringify(entries)).not.toContain("비밀스러운 본문");
  });
});
