import { describe, expect, test } from "vitest";
import {
  EMPTY_WORKSPACE_BRIEF,
  WORKSPACE_BRIEF_MAX_LENGTH,
  agentBriefParts,
  composeContinuationBrief,
  composeAgentBrief,
  workspaceBriefLength,
} from "./agent-brief.js";

const ticket = "Fix the checkout bug\n\nSteps to reproduce";
const protocol = "## 운영자에게 물을 때\n\n- ask 로 묻는다.";

describe("composeAgentBrief", () => {
  test("puts the before text, the ticket, the after text and the protocol in that order", () => {
    const brief = composeAgentBrief({
      workspace: { before: "Read AGENTS.md first.", after: "Open a PR to develop." },
      ticket,
      protocol,
    });
    expect(brief).toBe(
      `Read AGENTS.md first.\n\n${ticket}\n\nOpen a PR to develop.\n\n${protocol}\n`,
    );
  });

  test("leaves out empty and blank workspace texts", () => {
    expect(composeAgentBrief({ workspace: EMPTY_WORKSPACE_BRIEF, ticket, protocol })).toBe(
      `${ticket}\n\n${protocol}\n`,
    );
    expect(
      composeAgentBrief({ workspace: { before: "  \n", after: "\n\t" }, ticket, protocol }),
    ).toBe(`${ticket}\n\n${protocol}\n`);
  });

  test("keeps only the after text when the before text is empty", () => {
    const parts = agentBriefParts({
      workspace: { before: "", after: "Push the branch." },
      ticket,
      protocol,
    });
    expect(parts.map((part) => part.kind)).toEqual(["ticket", "after", "protocol"]);
  });

  test("trims the edges of each part but keeps the lines inside", () => {
    const parts = agentBriefParts({
      workspace: { before: "\n- one\n- two\n\n", after: "" },
      ticket,
      protocol,
    });
    expect(parts[0]).toEqual({ kind: "before", text: "- one\n- two" });
  });

  test("keeps long workspace texts whole up to the limit", () => {
    const before = "가".repeat(WORKSPACE_BRIEF_MAX_LENGTH);
    const brief = composeAgentBrief({ workspace: { before, after: "" }, ticket, protocol });
    expect(brief.startsWith(`${before}\n\n${ticket}`)).toBe(true);
  });
});

describe("workspaceBriefLength", () => {
  test("counts characters, not UTF-16 units", () => {
    expect(workspaceBriefLength("가나다")).toBe(3);
    expect(workspaceBriefLength("👍👍")).toBe(2);
  });
});

describe("이어서 맡기는 지시서", () => {
  const workspace = { before: "앞 지시", after: "뒤 지시" };

  test("운영자의 말 → 이전 런 보고 → 앞 지시 → 뒤 지시 → 통신 규약 순서로 합친다", () => {
    expect(
      composeContinuationBrief({
        workspace,
        ticket: "",
        protocol: "규약",
        operatorMessage: "  push 해 주세요  ",
        previousReport: "\n커밋했어요\n",
      }),
    ).toBe(
      "## 운영자의 말\n\npush 해 주세요\n\n## 이전 런의 완료 보고\n\n커밋했어요\n\n앞 지시\n\n뒤 지시\n\n규약\n",
    );
  });

  test("처음부터 시작하면 앞 지시와 뒤 지시 사이에 티켓을 넣는다", () => {
    expect(
      composeContinuationBrief({
        workspace,
        ticket: "제목\n\n본문",
        protocol: "규약",
        operatorMessage: "다시 해 주세요",
        previousReport: null,
      }),
    ).toBe("## 운영자의 말\n\n다시 해 주세요\n\n앞 지시\n\n제목\n\n본문\n\n뒤 지시\n\n규약\n");
  });

  test("이전 런 보고가 비어 있으면 그 칸을 뺀다", () => {
    expect(
      composeContinuationBrief({
        workspace: { before: "", after: "" },
        ticket: "",
        protocol: "규약",
        operatorMessage: "이어 주세요",
        previousReport: "   ",
      }),
    ).toBe("## 운영자의 말\n\n이어 주세요\n\n규약\n");
  });
});
