import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_REST_AFTER_TICK_MS, WAKE_BATCH_MS, startTickLoop } from "./tick-loop.js";
import type { TickLoop } from "./tick-loop.js";

const POLL_INTERVAL_MS = 10_000;

interface Recorded {
  starts: number[];
  ends: number[];
  warnings: string[];
}

let loop: TickLoop | undefined;

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
});

afterEach(async () => {
  loop?.stop();
  await loop?.stopped;
  loop = undefined;
  vi.useRealTimers();
});

function startRecording(
  tick: (recorded: Recorded) => Promise<void> = () => Promise.resolve(),
): Recorded {
  const recorded: Recorded = { starts: [], ends: [], warnings: [] };
  loop = startTickLoop({
    tick: async () => {
      recorded.starts.push(Date.now());
      try {
        await tick(recorded);
      } finally {
        recorded.ends.push(Date.now());
      }
    },
    pollIntervalMs: POLL_INTERVAL_MS,
    logger: { warn: (message) => recorded.warnings.push(message) },
  });
  return recorded;
}

function running(): TickLoop {
  if (loop === undefined) throw new Error("loop has not started");
  return loop;
}

async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

describe("바퀴 사이의 기다림", () => {
  it("앞 바퀴가 끝나고 1초 지난 뒤 쉬는 중에 wake 하면 250ms 뒤 폴링 간격보다 먼저 돈다", async () => {
    const recorded = startRecording();
    await advance(MIN_REST_AFTER_TICK_MS);
    expect(recorded.starts).toEqual([0]);

    running().wake();
    await advance(WAKE_BATCH_MS - 1);
    expect(recorded.starts).toEqual([0]);
    await advance(1);
    expect(recorded.starts).toEqual([0, MIN_REST_AFTER_TICK_MS + WAKE_BATCH_MS]);
  });

  it("wake 가 끊임없이 와도 바퀴 사이에 적어도 1초 쉰다", async () => {
    const recorded = startRecording(() => new Promise((resolve) => setTimeout(resolve, 300)));
    for (let elapsed = 0; elapsed < 20_000; elapsed += 10) {
      running().wake();
      await advance(10);
    }

    expect(recorded.starts.length).toBeGreaterThan(10);
    const rests = recorded.starts
      .slice(1)
      .map((start, index) => start - (recorded.ends[index] ?? 0));
    expect(Math.min(...rests)).toBeGreaterThanOrEqual(MIN_REST_AFTER_TICK_MS);
    expect(Math.max(...rests)).toBeLessThan(MIN_REST_AFTER_TICK_MS + 20);
  });

  it("바퀴 도중에 wake 를 여러 번 불러도 추가 바퀴는 정확히 하나다", async () => {
    let finish: () => void = () => undefined;
    const recorded = startRecording(({ starts }) =>
      starts.length === 1 ? new Promise((resolve) => (finish = resolve)) : Promise.resolve(),
    );
    await advance(500);
    running().wake();
    running().wake();
    await advance(500);
    running().wake();
    finish();
    await advance(0);
    expect(recorded.ends).toEqual([1_000]);

    await advance(MIN_REST_AFTER_TICK_MS);
    expect(recorded.starts).toEqual([0, 2_000]);
    await advance(POLL_INTERVAL_MS - 1);
    expect(recorded.starts).toEqual([0, 2_000]);
    await advance(1);
    expect(recorded.starts).toEqual([0, 2_000, 2_000 + POLL_INTERVAL_MS]);
  });

  it("wake 를 250ms 보다 짧은 간격으로 계속 불러도 첫 wake 뒤 250ms 에 돈다", async () => {
    const recorded = startRecording();
    await advance(5_000);
    for (let elapsed = 0; elapsed < WAKE_BATCH_MS; elapsed += 100) {
      running().wake();
      await advance(100);
    }

    expect(recorded.starts).toEqual([0, 5_000 + WAKE_BATCH_MS]);
  });

  it("wake 하지 않으면 폴링 간격대로 돌고, 바퀴가 실패해도 루프가 이어진다", async () => {
    const recorded = startRecording(({ starts }) =>
      starts.length === 1 ? Promise.reject(new Error("boom")) : Promise.resolve(),
    );
    await advance(POLL_INTERVAL_MS * 2);

    expect(recorded.starts).toEqual([0, POLL_INTERVAL_MS, POLL_INTERVAL_MS * 2]);
    expect(recorded.warnings).toEqual(["tick failed"]);
  });

  it("바퀴 사이에 시스템 시계가 뒤로 가도 wake 는 250ms 뒤, 폴링은 폴링 간격 뒤에 돈다", async () => {
    const recorded = startRecording();
    await advance(2_000);
    vi.setSystemTime(Date.now() - 3_600_000);

    running().wake();
    await advance(WAKE_BATCH_MS);
    expect(recorded.starts).toHaveLength(2);
    await advance(POLL_INTERVAL_MS);
    expect(recorded.starts).toHaveLength(3);
  });

  it("기다리는 중에 stop 하면 시계를 움직이지 않아도 바로 멈추고 더는 돌지 않는다", async () => {
    const recorded = startRecording();
    await advance(1_000);
    running().wake();

    running().stop();
    await running().stopped;
    await advance(POLL_INTERVAL_MS * 3);

    expect(recorded.starts).toEqual([0]);
  });
});
