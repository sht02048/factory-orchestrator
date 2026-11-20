import { describe, expect, it } from "vitest";
import { cancelPendingHide, hideWindow } from "./window-close.js";
import type { HideableWindow } from "./window-close.js";

class FakeWindow implements HideableWindow {
  fullScreen: boolean;
  visible = true;
  readonly calls: string[] = [];
  private readonly leaveListeners: (() => void)[] = [];

  constructor(fullScreen: boolean) {
    this.fullScreen = fullScreen;
  }

  isFullScreen(): boolean {
    return this.fullScreen;
  }

  setFullScreen(flag: boolean): void {
    this.calls.push(`setFullScreen(${String(flag)})`);
  }

  hide(): void {
    this.calls.push("hide");
    this.visible = false;
  }

  once(_event: "leave-full-screen", listener: () => void): this {
    this.leaveListeners.push(listener);
    return this;
  }

  removeListener(_event: "leave-full-screen", listener: () => void): this {
    const index = this.leaveListeners.indexOf(listener);
    if (index >= 0) this.leaveListeners.splice(index, 1);
    return this;
  }

  show(): void {
    this.calls.push("show");
    this.visible = true;
  }

  finishLeavingFullScreen(): void {
    this.fullScreen = false;
    for (const listener of this.leaveListeners.splice(0)) listener();
  }
}

describe("창 닫기(0138)", () => {
  it("일반 창은 바로 숨긴다", () => {
    const window = new FakeWindow(false);
    hideWindow(window);
    expect(window.calls).toEqual(["hide"]);
    expect(window.visible).toBe(false);
  });

  it("전체 화면 창은 전체 화면에서 나온 뒤에 숨겨 검은 공간을 남기지 않는다", () => {
    const window = new FakeWindow(true);
    hideWindow(window);
    expect(window.calls).toEqual(["setFullScreen(false)"]);
    expect(window.visible).toBe(true);

    window.finishLeavingFullScreen();
    expect(window.calls).toEqual(["setFullScreen(false)", "hide"]);
    expect(window.visible).toBe(false);
  });

  it("전체 화면에서 나오는 동안 다시 닫아도 나온 뒤 숨긴다", () => {
    const window = new FakeWindow(true);
    hideWindow(window);
    hideWindow(window);
    expect(window.visible).toBe(true);

    window.finishLeavingFullScreen();
    expect(window.visible).toBe(false);
    expect(window.calls.filter((call) => call === "hide")).toHaveLength(1);
  });

  it("전체 화면에서 나오는 동안 다시 열면 나온 뒤에도 숨기지 않는다", () => {
    const window = new FakeWindow(true);
    hideWindow(window);
    cancelPendingHide(window);
    window.show();

    window.finishLeavingFullScreen();
    expect(window.visible).toBe(true);
    expect(window.calls).toEqual(["setFullScreen(false)", "show"]);
  });

  it("숨기기를 기다리지 않는 창에서 취소해도 아무 일도 하지 않는다", () => {
    const window = new FakeWindow(false);
    cancelPendingHide(window);
    expect(window.calls).toEqual([]);
  });
});
