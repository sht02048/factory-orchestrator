import { toRunId } from "@ganger/core";
import { getRun } from "@ganger/db";
import { describe, expect, it } from "vitest";
import { TICKET_TITLE_MAX_LENGTH, assignInput, submitAssignment } from "./assign";
import type { AssignInput } from "./assign";
import { connection, docsProject, now, setupTickets, webProject } from "./test-fixtures";

const base: AssignInput = {
  connection,
  ticketKey: "ACME-6",
  ticketTitle: "Checkout retry",
  trackerProject: webProject,
  runnerId: null,
  agent: "claude",
};

function assignedRun(
  db: Parameters<typeof getRun>[0],
  result: ReturnType<typeof submitAssignment>,
) {
  if (!result.ok) throw new Error(`assign failed: ${result.reason}`);
  const run = getRun(db, toRunId(result.runId));
  if (run === null) throw new Error("run not saved");
  return run;
}

describe("수동 할당", () => {
  it("Mapping 기본값 그대로 할당하면 러너를 자동으로 골라 Queued 런을 만든다", () => {
    const { db } = setupTickets();
    const run = assignedRun(db, submitAssignment(db, base, now));
    expect(run).toMatchObject({
      state: "queued",
      ticket: { connection: "conn-acme", key: "ACME-6" },
      trackerProject: "tp-web",
      runnerProject: "github:acme/web",
      agent: "claude",
      runnerId: "runner-a",
      assignedAt: now,
    });
  });

  it("Tickets 화면이 트래커에서 읽은 제목을 앞뒤 공백 없이 런에 저장한다(0064)", () => {
    const { db } = setupTickets();
    const parsed = assignInput.parse({ ...base, ticketTitle: "  결제 실패 재시도  " });
    expect(assignedRun(db, submitAssignment(db, parsed, now)).ticketTitle).toBe("결제 실패 재시도");
  });

  it("빈 제목은 비워 두고, 상한보다 긴 제목은 받지 않는다(0064)", () => {
    const { db } = setupTickets();
    const blank = assignInput.parse({ ...base, ticketTitle: "   " });
    expect(assignedRun(db, submitAssignment(db, blank, now)).ticketTitle).toBeNull();
    expect(
      assignInput.safeParse({ ...base, ticketTitle: "가".repeat(TICKET_TITLE_MAX_LENGTH + 1) })
        .success,
    ).toBe(false);
    expect(
      assignInput.safeParse({ ...base, ticketTitle: "가".repeat(TICKET_TITLE_MAX_LENGTH) }).success,
    ).toBe(true);
  });

  it("러너와 에이전트를 바꿔 할당한 값이 런에 저장된다", () => {
    const { db } = setupTickets();
    const run = assignedRun(
      db,
      submitAssignment(db, { ...base, runnerId: "runner-b", agent: "codex" }, now),
    );
    expect(run).toMatchObject({
      runnerId: "runner-b",
      agent: "codex",
      runnerProject: "github:acme/web",
    });
  });

  it("Mapping 의 모델을 런에 적고, 에이전트를 바꾸면 모델을 넘기지 않는다(0043)", () => {
    const { db } = setupTickets();
    expect(assignedRun(db, submitAssignment(db, base, now)).model).toBe("sonnet");
    const changed = assignedRun(
      db,
      submitAssignment(db, { ...base, ticketKey: "ACME-7", agent: "codex" }, now),
    );
    expect(changed).toMatchObject({ agent: "codex", model: null });
    expect(assignInput.parse({ ...base, model: "opus" })).not.toHaveProperty("model");
  });

  it("러너 쪽 프로젝트는 바꿀 수 없다: 입력에 넣어도 버리고 Mapping 값을 쓴다", () => {
    const { db } = setupTickets();
    const input = assignInput.parse({ ...base, runnerProject: "github:acme/lab" });
    expect(input).not.toHaveProperty("runnerProject");
    expect(assignedRun(db, submitAssignment(db, input, now)).runnerProject).toBe("github:acme/web");
  });

  it("진행 중이거나 Queued 인 런이 있는 티켓은 할당하지 않는다", () => {
    const { db } = setupTickets();
    for (const key of ["ACME-3", "ACME-4", "ACME-5"]) {
      expect(submitAssignment(db, { ...base, ticketKey: key }, now)).toEqual({
        ok: false,
        reason: "active-run",
      });
    }
    expect(submitAssignment(db, base, now).ok).toBe(true);
    expect(submitAssignment(db, base, now)).toEqual({ ok: false, reason: "active-run" });
  });

  it("GitHub 인증이 깨진 러너는 고를 수 없다(Q87)", () => {
    const { db } = setupTickets();
    expect(submitAssignment(db, { ...base, runnerId: "runner-c" }, now)).toEqual({
      ok: false,
      reason: "runner-assignment-blocked",
    });
  });

  it("그 러너 쪽 프로젝트가 없는 러너, 모르는 에이전트, Mapping 없는 프로젝트는 막는다", () => {
    const { db } = setupTickets();
    expect(submitAssignment(db, { ...base, runnerId: "runner-d" }, now)).toEqual({
      ok: false,
      reason: "unknown-runner",
    });
    expect(submitAssignment(db, { ...base, runnerId: "runner-x" }, now)).toEqual({
      ok: false,
      reason: "unknown-runner",
    });
    expect(submitAssignment(db, { ...base, agent: "gemini" }, now)).toEqual({
      ok: false,
      reason: "unknown-agent",
    });
    expect(
      submitAssignment(db, { ...base, ticketKey: "DOC-1", trackerProject: docsProject }, now),
    ).toEqual({ ok: false, reason: "no-mapping" });
  });
});
