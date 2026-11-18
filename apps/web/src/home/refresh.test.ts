import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshWhileVisible } from "./refresh";
import type { VisibilitySource } from "./refresh";

/** visibilityState 를 바꾸고 visibilitychange 를 알리는 가짜 문서 */
class FakeDocument implements VisibilitySource {
  visibilityState: DocumentVisibilityState = "visible";
  private readonly target = new EventTarget();
  addEventListener(type: "visibilitychange", listener: () => void): void {
    this.target.addEventListener(type, listener);
  }
  removeEventListener(type: "visibilitychange", listener: () => void): void {
    this.target.removeEventListener(type, listener);
  }
  set(state: DocumentVisibilityState): void {
    this.visibilityState = state;
    this.target.dispatchEvent(new Event("visibilitychange"));
  }
}

describe("refreshWhileVisible", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("보이는 동안 주기마다 다시 읽고, 시작할 때는 읽지 않는다", () => {
    const doc = new FakeDocument();
    const refresh = vi.fn<() => void>();
    const stop = refreshWhileVisible(doc, refresh, 15_000);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(15_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(3);
    stop();
  });

  it("숨겨지면 멈추고, 다시 보이면 곧바로 한 번 읽은 뒤 다시 돈다", () => {
    const doc = new FakeDocument();
    const refresh = vi.fn<() => void>();
    const stop = refreshWhileVisible(doc, refresh, 15_000);
    doc.set("hidden");
    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();
    doc.set("visible");
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(15_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it("숨겨진 채 시작하면 보일 때까지 읽지 않는다", () => {
    const doc = new FakeDocument();
    doc.visibilityState = "hidden";
    const refresh = vi.fn<() => void>();
    const stop = refreshWhileVisible(doc, refresh, 15_000);
    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();
    stop();
  });

  it("멈추면 타이머와 visibilitychange 를 함께 푼다", () => {
    const doc = new FakeDocument();
    const refresh = vi.fn<() => void>();
    refreshWhileVisible(doc, refresh, 15_000)();
    vi.advanceTimersByTime(60_000);
    doc.set("hidden");
    doc.set("visible");
    expect(refresh).not.toHaveBeenCalled();
  });
});
