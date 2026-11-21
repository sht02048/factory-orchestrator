import { toQuestionId } from "@ganger/core";
import type { RunnerErrorDetail, RunnerId, WorktreeRef } from "@ganger/core";
import {
  changeRunState,
  getRun,
  listRunAgentMessages,
  markAgentMessageSending,
  requestAgentMessage,
  requestRunCancel,
  requestRunControl,
  runTimeline,
} from "@ganger/db";
import type { StoredRun } from "@ganger/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

function only(run: StoredRun) {
  const [message] = listRunAgentMessages(h.db, run.id);
  if (message === undefined) throw new Error("no message");
  return message;
}

describe("에이전트에게 보내기(0147)", () => {
  it("Running 런의 말을 러너로 보내고 완료로 적으며 상태는 그대로다", async () => {
    const { run, runnerId, worker } = await startOne();
    expect(requestAgentMessage(h.db, run.id, "push 해 주세요", h.now)).toMatchObject({ ok: true });
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

    requestAgentMessage(h.db, run.id, "참고로 main 기준이에요", h.now);
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

    requestAgentMessage(h.db, run.id, "재개하면 PR 까지", h.now);
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
    requestAgentMessage(h.db, run.id, "보내면 안 돼요", h.now);
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
    requestAgentMessage(h.db, run.id, "안 닿는 말", h.now);
    await worker.tick();
    expect(only(run).error).toBe("agent-not-running");
    await worker.tick();
    expect(sentTo(run, runnerId)).toEqual([]);
  });

  it("보내기 시작만 적히고 끝나지 않은 말은 두 번 보내지 않고 확인하지 못했다고 남긴다", async () => {
    const { run, runnerId, worker } = await startOne();
    const sent = requestAgentMessage(h.db, run.id, "한 번만", h.now);
    if (!sent.ok) throw new Error("not requested");
    expect(markAgentMessageSending(h.db, sent.id, h.now)).toBe(true);
    await worker.tick();
    expect(sentTo(run, runnerId)).toEqual([]);
    expect(only(run).error).toBe("outcome-unknown");
  });

  it("끝난 런과 취소 중인 런은 요청을 받지 않는다", async () => {
    const { run } = await startOne();
    requestRunCancel(h.db, run.id, h.now);
    expect(requestAgentMessage(h.db, run.id, "늦은 말", h.now)).toEqual({
      ok: false,
      reason: "cancelling",
    });
    changeRunState(h.db, run.id, {
      to: "ended",
      agentResult: "canceled",
      prState: "none",
    });
    expect(requestAgentMessage(h.db, run.id, "늦은 말", h.now)).toEqual({
      ok: false,
      reason: "not-accepting",
    });
  });

  it("진단용 타임라인에는 보낸 말의 본문을 넣지 않는다", async () => {
    const { run, worker } = await startOne();
    requestAgentMessage(h.db, run.id, "비밀스러운 본문", h.now);
    await worker.tick();
    const entries = runTimeline(h.db, run.id)?.entries ?? [];
    expect(entries.filter((entry) => entry.source === "agent-message").map((e) => e.event)).toEqual(
      ["requested", "sent"],
    );
    expect(JSON.stringify(entries)).not.toContain("비밀스러운 본문");
  });
});
