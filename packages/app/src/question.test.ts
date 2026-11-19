import { describe, expect, test } from "vitest";
import { paragraphsOf, questionSummary, readQuestion } from "./question.js";

const OPERATOR_QUESTION =
  "02 작업 전제인 01(시계 adapter 하나로 합치기, KanbanRunnerTimers·KanbanSchedulerTimers 합침)이 main(48619dac1)과 원격 브랜치 어디에도 없어요. 어떻게 할까요? (A) 01 이 머지될 때까지 기다린다 — 01 브랜치/PR 을 알려 주면 그 위에서 시작 (B) 지금 main 의 KanbanSchedulerTimers 를 그대로 받는 run-pulse 로 02 를 먼저 하고, 01 이 들어오면 맞춘다(충돌 가능). 기본 제안은 B 예요.";

describe("readQuestion with ask options", () => {
  test("uses the options as they are and keeps the body as the question", () => {
    const read = readQuestion("Which cache?\n\nIt runs on every tick.", [
      "SQLite (추천)",
      "In memory",
    ]);
    expect(read).toEqual({
      lead: ["Which cache?", "It runs on every tick."],
      choices: [
        { marker: null, text: "SQLite (추천)", answer: "SQLite (추천)" },
        { marker: null, text: "In memory", answer: "In memory" },
      ],
      after: [],
    });
  });

  test("does not split the body even when it also lists choices", () => {
    const read = readQuestion("Pick one? (A) left (B) right", ["Left", "Right"]);
    expect(read.lead).toEqual(["Pick one? (A) left (B) right"]);
    expect(read.choices.map((choice) => choice.answer)).toEqual(["Left", "Right"]);
  });
});

describe("readQuestion without options", () => {
  test("splits the operator's inline (A) (B) question and keeps the recommendation apart", () => {
    const read = readQuestion(OPERATOR_QUESTION, []);
    expect(read.lead).toEqual([
      "02 작업 전제인 01(시계 adapter 하나로 합치기, KanbanRunnerTimers·KanbanSchedulerTimers 합침)이 main(48619dac1)과 원격 브랜치 어디에도 없어요. 어떻게 할까요?",
    ]);
    expect(read.choices).toEqual([
      {
        marker: "A",
        text: "01 이 머지될 때까지 기다린다 — 01 브랜치/PR 을 알려 주면 그 위에서 시작",
        answer: "(A) 01 이 머지될 때까지 기다린다 — 01 브랜치/PR 을 알려 주면 그 위에서 시작",
      },
      {
        marker: "B",
        text: "지금 main 의 KanbanSchedulerTimers 를 그대로 받는 run-pulse 로 02 를 먼저 하고, 01 이 들어오면 맞춘다(충돌 가능).",
        answer:
          "(B) 지금 main 의 KanbanSchedulerTimers 를 그대로 받는 run-pulse 로 02 를 먼저 하고, 01 이 들어오면 맞춘다(충돌 가능).",
      },
    ]);
    expect(read.after).toEqual(["기본 제안은 B 예요."]);
  });

  test("splits inline A) B) C) markers", () => {
    const read = readQuestion(
      "어느 쪽으로 할까요? A) 지금 고친다 B) 다음 티켓으로 미룬다 C) 둘 다 안 한다",
      [],
    );
    expect(read.choices.map((choice) => [choice.marker, choice.text])).toEqual([
      ["A", "지금 고친다"],
      ["B", "다음 티켓으로 미룬다"],
      ["C", "둘 다 안 한다"],
    ]);
  });

  test("splits a numbered list on its own lines and keeps the text after it", () => {
    const read = readQuestion(
      "Tests fail on main.\n\nWhat should I do?\n1. Fix them in this PR\n2. Skip them\n   and open a follow-up ticket\n\nI will wait for your answer.",
      [],
    );
    expect(read.lead).toEqual(["Tests fail on main.", "What should I do?"]);
    expect(read.choices).toEqual([
      { marker: "1", text: "Fix them in this PR", answer: "(1) Fix them in this PR" },
      {
        marker: "2",
        text: "Skip them and open a follow-up ticket",
        answer: "(2) Skip them and open a follow-up ticket",
      },
    ]);
    expect(read.after).toEqual(["I will wait for your answer."]);
  });

  test("splits (a) (b) lines separated by blank lines", () => {
    const read = readQuestion("Which one?\n\n(a) keep\n\n(b) drop", []);
    expect(read.choices.map((choice) => choice.answer)).toEqual(["(a) keep", "(b) drop"]);
    expect(read.after).toEqual([]);
  });

  test("keeps the text whole when the list is not a choice between answers", () => {
    const body = "I did this:\n1. Read the code\n2. Ran the tests\nAll passed.";
    expect(readQuestion(body, [])).toEqual({ lead: [body], choices: [], after: [] });
  });

  test("keeps the text whole when the question comes only after the list", () => {
    const body = "다음을 했어요.\n1. 빌드\n2. 테스트\n이대로 머지할까요?";
    expect(readQuestion(body, [])).toEqual({ lead: [body], choices: [], after: [] });
    expect(questionSummary(body, [])).toBe(body);
  });

  test("keeps the text whole when numbered words come later in a sentence after the question", () => {
    const body = "Is this OK? I checked step 1) the db and 2) the cache already.";
    expect(readQuestion(body, [])).toEqual({ lead: [body], choices: [], after: [] });
  });

  test("splits choices introduced with a colon after the question", () => {
    const read = readQuestion("Which cache should I use? Options: (A) SQLite (B) memory", []);
    expect(read.choices.map((choice) => choice.answer)).toEqual(["(A) SQLite", "(B) memory"]);
  });

  test("finds a choice marker right after another marker", () => {
    const read = readQuestion("Which? (A) foo, see (a) (B) bar", []);
    expect(read.choices.map((choice) => choice.marker)).toEqual(["A", "B"]);
  });

  test("skips a done list and splits the choice list after the question", () => {
    const read = readQuestion("Plan:\n1. a\n2. b\n\nWhich?\nA. x\nB. y", []);
    expect(read.lead).toEqual(["Plan:\n1. a\n2. b", "Which?"]);
    expect(read.choices.map((choice) => choice.answer)).toEqual(["(A) x", "(B) y"]);
  });

  test("keeps the text whole when the markers are not in order", () => {
    const body = "Which plan? (B) later (A) now";
    expect(readQuestion(body, [])).toEqual({ lead: [body], choices: [], after: [] });
  });

  test("keeps the text whole when there is only one marker", () => {
    const body = "Should I go with plan (A) as written?";
    expect(readQuestion(body, []).choices).toEqual([]);
  });

  test("keeps paragraphs and line breaks of a plain question", () => {
    expect(readQuestion("First line\nsecond line\n\n\nNew paragraph?", [])).toEqual({
      lead: ["First line\nsecond line", "New paragraph?"],
      choices: [],
      after: [],
    });
  });
});

describe("questionSummary", () => {
  test("drops the choices so a card shows only the question", () => {
    expect(questionSummary(OPERATOR_QUESTION, [])).toBe(
      "02 작업 전제인 01(시계 adapter 하나로 합치기, KanbanRunnerTimers·KanbanSchedulerTimers 합침)이 main(48619dac1)과 원격 브랜치 어디에도 없어요. 어떻게 할까요?",
    );
  });

  test("keeps the body when it has no choices in it", () => {
    expect(questionSummary("Proceed?", [])).toBe("Proceed?");
  });
});

describe("paragraphsOf", () => {
  test("drops empty paragraphs", () => {
    expect(paragraphsOf("  \n\n")).toEqual([]);
  });
});
