import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DelayedPending,
  PENDING_SHOWN_AT_LEAST_MS,
  PENDING_SHOW_AFTER_MS,
  realTimers,
} from "./navigation-pending";

function setup() {
  const changes: boolean[] = [];
  const pending = new DelayedPending(realTimers, (shown) => changes.push(shown));
  return { pending, changes };
}

describe("화면 이동 진행 표시 시점(0122)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it(`${PENDING_SHOW_AFTER_MS}ms 안에 끝난 이동은 진행 표시를 켜지 않는다`, () => {
    const { pending, changes } = setup();
    pending.set(true);
    vi.advanceTimersByTime(PENDING_SHOW_AFTER_MS - 1);
    pending.set(false);
    vi.advanceTimersByTime(1_000);
    expect(changes).toEqual([]);
  });

  it(`늦은 이동은 ${PENDING_SHOW_AFTER_MS}ms 뒤 켜고, 곧 끝나도 ${PENDING_SHOWN_AT_LEAST_MS}ms 는 두어 깜박이지 않는다`, () => {
    const { pending, changes } = setup();
    pending.set(true);
    vi.advanceTimersByTime(PENDING_SHOW_AFTER_MS);
    expect(changes).toEqual([true]);

    vi.advanceTimersByTime(10);
    pending.set(false);
    vi.advanceTimersByTime(PENDING_SHOWN_AT_LEAST_MS - 11);
    expect(changes).toEqual([true]);
    vi.advanceTimersByTime(1);
    expect(changes).toEqual([true, false]);
  });

  it("켜 둔 채 잇달아 이동하면 끄지 않고 이어서 보인다", () => {
    const { pending, changes } = setup();
    pending.set(true);
    vi.advanceTimersByTime(PENDING_SHOW_AFTER_MS);
    pending.set(false);
    vi.advanceTimersByTime(50);
    pending.set(true);
    vi.advanceTimersByTime(PENDING_SHOWN_AT_LEAST_MS * 2);
    expect(changes).toEqual([true]);

    pending.set(false);
    expect(changes).toEqual([true, false]);
  });
});
