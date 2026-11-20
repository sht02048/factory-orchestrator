import { describe, expect, it } from "vitest";
import { createSavedResync } from "./synced-save";

describe("저장된 값으로 초안 다시 맞추기(0128)", () => {
  it("저장하지 않을 때 저장된 값이 바뀌면 바로 맞춘다", () => {
    const resync = createSavedResync();
    expect(resync.savedChanged(false)).toBe(true);
  });

  it("저장하는 동안 바뀐 저장된 값은 저장이 끝난 뒤 맞춘다", () => {
    const resync = createSavedResync();
    expect(resync.stateChanged("sending")).toBe(false);
    expect(resync.savedChanged(true)).toBe(false);
    expect(resync.stateChanged("idle")).toBe(true);
    expect(resync.stateChanged("idle")).toBe(false);
  });

  it("저장하는 동안 저장된 값이 그대로면 저장이 끝나도 초안을 건드리지 않는다", () => {
    const resync = createSavedResync();
    expect(resync.stateChanged("sending")).toBe(false);
    expect(resync.stateChanged("idle")).toBe(false);
  });

  it("저장이 실패하면 되돌리기에 맡기고 다음 저장에 넘기지 않는다", () => {
    const resync = createSavedResync();
    expect(resync.savedChanged(true)).toBe(false);
    expect(resync.stateChanged("failed")).toBe(false);
    expect(resync.stateChanged("sending")).toBe(false);
    expect(resync.stateChanged("idle")).toBe(false);
  });
});
