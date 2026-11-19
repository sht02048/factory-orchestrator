import { describe, expect, it } from "vitest";
import { HIDDEN_TITLE_BAR, isTitleBarHidden } from "./window-chrome.js";

describe("창 제목 표시줄 쿠키(0113)", () => {
  it("데스크톱 앱이 심은 값일 때만 제목 표시줄이 숨었다고 본다", () => {
    expect(isTitleBarHidden(HIDDEN_TITLE_BAR)).toBe(true);
    expect(isTitleBarHidden(undefined)).toBe(false);
    expect(isTitleBarHidden("")).toBe(false);
    expect(isTitleBarHidden("shown")).toBe(false);
  });
});
