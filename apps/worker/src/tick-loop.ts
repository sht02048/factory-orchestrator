import type { WorkerLogger } from "./context.js";

export const WAKE_BATCH_MS = 250;
export const MIN_REST_AFTER_TICK_MS = 1_000;

export interface TickLoopOptions {
  tick: () => Promise<void>;
  pollIntervalMs: number;
  logger: WorkerLogger;
}

export interface TickLoop {
  wake(): void;
  stop(): void;
  stopped: Promise<void>;
}

export function startTickLoop(options: TickLoopOptions): TickLoop {
  let stopped = false;
  let woken = false;
  let firstWakeAt = 0;
  let tickEndedAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let endSleep: (() => void) | null = null;

  const nextTickAt = (): number => {
    const pollAt = tickEndedAt + options.pollIntervalMs;
    if (!woken) return pollAt;
    const wakeAt = Math.max(firstWakeAt + WAKE_BATCH_MS, tickEndedAt + MIN_REST_AFTER_TICK_MS);
    return Math.min(pollAt, wakeAt);
  };

  const wakeUp = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const resolve = endSleep;
    endSleep = null;
    resolve?.();
  };

  const schedule = (): void => {
    if (endSleep === null) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(wakeUp, Math.max(0, nextTickAt() - Date.now()));
  };

  const sleep = (): Promise<void> =>
    new Promise((resolve) => {
      endSleep = resolve;
      schedule();
    });

  const run = async (): Promise<void> => {
    while (!stopped) {
      woken = false;
      try {
        await options.tick();
      } catch (error) {
        options.logger.warn("tick failed", { error });
      }
      tickEndedAt = Date.now();
      if (!stopped) await sleep();
    }
  };

  return {
    wake: () => {
      if (stopped || woken) return;
      woken = true;
      firstWakeAt = Date.now();
      schedule();
    },
    stop: () => {
      stopped = true;
      wakeUp();
    },
    stopped: run(),
  };
}
