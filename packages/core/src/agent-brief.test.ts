import { describe, expect, test } from "vitest";
import {
  EMPTY_WORKSPACE_BRIEF,
  WORKSPACE_BRIEF_MAX_LENGTH,
  agentBriefParts,
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
