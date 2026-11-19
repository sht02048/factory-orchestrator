import { describe, expect, it } from "vitest";
import { copyText } from "./clipboard";

describe("copyText", () => {
  it("클립보드에 쓰면 성공을 알린다", async () => {
    const written: string[] = [];
    const clipboard = {
      writeText: (text: string) => {
        written.push(text);
        return Promise.resolve();
      },
    };
    expect(await copyText("mcp_servers:", clipboard)).toBe(true);
    expect(written).toEqual(["mcp_servers:"]);
  });

  it("보안 컨텍스트가 아니라 클립보드가 없으면 실패를 알린다", async () => {
    expect(await copyText("mcp_servers:", undefined)).toBe(false);
  });

  it("쓰기가 거절되거나 바로 던져도 실패를 알린다", async () => {
    expect(await copyText("x", { writeText: () => Promise.reject(new Error("denied")) })).toBe(
      false,
    );
    expect(
      await copyText("x", {
        writeText: () => {
          throw new Error("not allowed");
        },
      }),
    ).toBe(false);
  });
});
