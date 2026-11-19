import { describe, expect, it } from "vitest";
import { MAX_MCP_CLIENT_NAME_LENGTH, UNNAMED_MCP_CLIENT, mcpClientName } from "./actions.js";

describe("MCP 클라이언트 이름", () => {
  it("보낸 이름을 그대로 쓴다", () => {
    expect(mcpClientName("hermes")).toBe("hermes");
    expect(mcpClientName("Operator")).toBe("Operator");
  });

  it("제어 문자·방향 바꾸기 문자·줄바꿈을 지우고 공백을 하나로 줄인다", () => {
    expect(mcpClientName("her\u0000mes‮\n  bot\t")).toBe("hermes bot");
    expect(mcpClientName("a b c​d")).toBe("abcd");
  });

  it("길이를 글자 수로 자른다", () => {
    const long = "가".repeat(MAX_MCP_CLIENT_NAME_LENGTH + 10);
    expect(Array.from(mcpClientName(long))).toHaveLength(MAX_MCP_CLIENT_NAME_LENGTH);
    expect(mcpClientName("😀".repeat(100))).toBe("😀".repeat(MAX_MCP_CLIENT_NAME_LENGTH));
  });

  it("이름이 없거나 지우고 나서 비면 이름 없음으로 둔다", () => {
    expect(mcpClientName(undefined)).toBe(UNNAMED_MCP_CLIENT);
    expect(mcpClientName(" \u0007 ")).toBe(UNNAMED_MCP_CLIENT);
  });
});
