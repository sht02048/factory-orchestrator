import {
  AnswerRejectedError,
  humanCheckAnswerInput,
  humanCheckAnswerText,
  submitAnswer,
  submitHumanCheckAnswer,
} from "@ganger/app/home/actions";
import { loadHomePage, pendingInput } from "@ganger/app/home/load";
import { todoGroups, todoTagOf } from "@ganger/app/home/model";
import { notificationCauses } from "@ganger/app/notifications/causes";
import { toQuestionId, toTicketKey } from "@ganger/core";
import type { RunId } from "@ganger/core";
import { changeRunState, listRunQuestions, listRuns, recordRunQuestions } from "@ganger/db";
import type { Database } from "@ganger/db";
import { describe, expect, it } from "vitest";
import { bodyParts } from "../question/human-check-answer";
import { minutes, now, seedDatabase } from "../testing/seed";

const CHECK_ID = "msg-check";

function seedHumanCheck(): { db: Database; runId: RunId } {
  const { db } = seedDatabase();
  const running = listRuns(db, { states: ["running"] }).find(
    (run) => run.ticket.key === toTicketKey("ACME-10"),
  );
  if (running === undefined) throw new Error("no running run");
  const changed = changeRunState(db, running.id, { to: "waiting-for-input" }, minutes(110));
  if (!changed.ok) throw new Error("state change failed");
  recordRunQuestions(db, running.id, [
    {
      id: toQuestionId(CHECK_ID),
      kind: "human-check",
      body: "PR #7 머지를 확인해 주세요\n\nhttps://github.com/acme/widgets/pull/7",
      options: [],
      askedAt: minutes(110),
    },
  ]);
  return { db, runId: running.id };
}

describe("Human Check 요청", () => {
  it("Waiting for Input 의 Human Check 종류로 읽고 Question 과 다른 묶음에 둔다", () => {
    const { db, runId } = seedHumanCheck();
    expect(pendingInput(db, runId)).toMatchObject({ kind: "human-check", answered: false });

    const page = loadHomePage(db, "ws-commerce", now, "UTC");
    const groups = todoGroups(page.attention);
    expect(groups.map((group) => group.kind)).toEqual(["check", "answer", "stopped"]);
    const [check] = groups;
    expect(check?.runs.map((run) => run.id)).toEqual([runId]);
    expect(check?.runs[0] === undefined ? null : todoTagOf(check.runs[0])).toBe("human-check");
  });

  it("답하기 전에는 Human Check 알림 사건을 내고, 답하면 내지 않는다", () => {
    const { db, runId } = seedHumanCheck();
    const causesOf = () =>
      notificationCauses(loadHomePage(db, "ws-commerce", now, "UTC"), [], now).filter(
        (cause) => cause.kind === "human-check",
      );
    expect(causesOf().map((cause) => cause.cause)).toEqual([`human-check:${runId}:${CHECK_ID}`]);

    submitHumanCheckAnswer(
      db,
      { runId, questionId: CHECK_ID, decision: "confirmed", note: "" },
      now,
    );
    expect(causesOf()).toEqual([]);
  });

  it.each([
    ["confirmed", "", "확인했어요"],
    ["confirmed", "좋아요", "확인했어요\n\n좋아요"],
    ["changes-requested", "", "고쳐 주세요"],
    ["changes-requested", "시험을 더해 주세요", "고쳐 주세요\n\n시험을 더해 주세요"],
  ] as const)(
    "답 %s + 함께 보낼 말 '%s' 를 에이전트에게 보낼 글로 저장한다",
    (decision, note, text) => {
      expect(humanCheckAnswerText(decision, note)).toBe(text);
      const { db, runId } = seedHumanCheck();
      submitHumanCheckAnswer(db, { runId, questionId: CHECK_ID, decision, note }, now);
      expect(listRunQuestions(db, runId).at(-1)?.answer?.text).toBe(text);
    },
  );

  it("함께 보낼 말의 앞뒤 빈칸을 다듬고, 정해진 두 답 밖의 값은 받지 않는다", () => {
    const base = { runId: "r", questionId: "q" };
    expect(
      humanCheckAnswerInput.parse({ ...base, decision: "confirmed", note: "  네  " }).note,
    ).toBe("네");
    expect(humanCheckAnswerInput.safeParse({ ...base, decision: "merge", note: "" }).success).toBe(
      false,
    );
  });

  it("일반 질문 답하기로는 Human Check 에 답하지 못한다", () => {
    const { db, runId } = seedHumanCheck();
    expect(() => {
      submitAnswer(db, { runId, questionId: CHECK_ID, answer: "확인했어요" }, now);
    }).toThrow(AnswerRejectedError);
    expect(listRunQuestions(db, runId).at(-1)?.answer).toBeNull();
  });

  it("요청 글의 http 링크만 문장 부호 없이 링크로 나눈다", () => {
    expect(bodyParts("보세요: https://example.com/a. 그리고 (https://example.com/b)")).toEqual([
      { kind: "text", value: "보세요: " },
      { kind: "link", value: "https://example.com/a" },
      { kind: "text", value: ". 그리고 (" },
      { kind: "link", value: "https://example.com/b" },
      { kind: "text", value: ")" },
    ]);
    expect(bodyParts("javascript:alert(1)")).toEqual([
      { kind: "text", value: "javascript:alert(1)" },
    ]);
  });
});
