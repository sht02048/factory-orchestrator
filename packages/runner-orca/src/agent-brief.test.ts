import { describe, expect, test } from "vitest";
import { ASK_GUIDE } from "./agent-brief.js";
import { ScriptedExec, runnerWith } from "./test-support.js";

describe("ASK_GUIDE", () => {
  test("is the protocol the Orca runner adds to every agent brief", () => {
    expect(runnerWith(new ScriptedExec()).agentProtocol).toBe(ASK_GUIDE);
    expect(ASK_GUIDE.startsWith("## 운영자에게 물을 때")).toBe(true);
  });

  test("tells the agent to pass choices through ask --options, not inside the question", () => {
    expect(ASK_GUIDE).toContain('--options "<선택지1>,<선택지2>"');
    expect(ASK_GUIDE).toContain("질문 문장에는 선택지를 다시 쓰지 않는다");
    expect(ASK_GUIDE).toContain("한 선택지 안에는 쉼표를 쓰지 않는다");
  });

  test("tells the agent to put the recommended choice first with a marker", () => {
    expect(ASK_GUIDE).toContain("첫 선택지로 두고 끝에 ` (추천)`을 붙인다");
  });

  test("tells the agent to ask with options instead of escalating when blocked", () => {
    expect(ASK_GUIDE).toContain("`escalation`을 보내지 않고 `ask`로 묻는다");
    expect(ASK_GUIDE).toContain("다음 행동을 `--options`로 단다");
  });
});
