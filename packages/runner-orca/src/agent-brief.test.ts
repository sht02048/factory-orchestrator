import { describe, expect, test } from "vitest";
import { ASK_GUIDE, briefFor } from "./agent-brief.js";

describe("briefFor", () => {
  const brief = briefFor("Fix the bug\n\nSteps to reproduce");

  test("keeps the ticket first and adds the ask guide after it", () => {
    expect(brief.startsWith("Fix the bug\n\nSteps to reproduce\n\n")).toBe(true);
    expect(brief).toContain(ASK_GUIDE);
  });

  test("tells the agent to pass choices through ask --options, not inside the question", () => {
    expect(brief).toContain('--options "<선택지1>,<선택지2>"');
    expect(brief).toContain("질문 문장에는 선택지를 다시 쓰지 않는다");
    expect(brief).toContain("한 선택지 안에는 쉼표를 쓰지 않는다");
  });

  test("tells the agent to put the recommended choice first with a marker", () => {
    expect(brief).toContain("첫 선택지로 두고 끝에 ` (추천)`을 붙인다");
  });
});
