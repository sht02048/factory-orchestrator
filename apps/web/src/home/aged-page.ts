import { useEffect, useMemo, useState } from "react";
import type { DashboardRunner, DoneRun, HomePage, HomeRun } from "@ganger/app/home/model";

export const TIME_TEXT_TICK_MS = 15_000;

function later(ms: number | null, by: number): number | null {
  return ms === null ? null : ms + by;
}

function ageRun(run: HomeRun, by: number): HomeRun {
  switch (run.state) {
    case "queued":
      return { ...run, waitMs: run.waitMs + by };
    case "running":
      return { ...run, executionMs: later(run.executionMs, by) };
    case "paused":
      return { ...run, pausedMs: later(run.pausedMs, by) };
    case "waiting-for-input":
      return { ...run, waitingMs: later(run.waitingMs, by) };
    case "disconnected":
      return { ...run, unreachableMs: later(run.unreachableMs, by) };
    case "ended":
      return { ...run, endedAgoMs: run.endedAgoMs + by };
  }
}

function ageRunner(runner: DashboardRunner, by: number): DashboardRunner {
  return {
    ...runner,
    offlineMs: later(runner.offlineMs, by),
    limits: runner.limits.map((limit) => ({
      ...limit,
      resetsInMs: limit.resetsInMs === null ? null : Math.max(0, limit.resetsInMs - by),
    })),
  };
}

function ageDone(run: DoneRun, by: number): DoneRun {
  return { ...run, endedAgoMs: run.endedAgoMs + by };
}

export function agedHomePage(page: HomePage, by: number): HomePage {
  if (by <= 0) return page;
  return {
    ...page,
    attention: page.attention.map((item) => ({ ...item, run: ageRun(item.run, by) })),
    running: page.running.map((run) => ageRun(run, by)),
    queued: page.queued.map((run) => ageRun(run, by)),
    endedToday: page.endedToday.map((run) => ageRun(run, by)),
    doneToday: { ...page.doneToday, recent: page.doneToday.recent.map((run) => ageDone(run, by)) },
    runners: { list: page.runners.list.map((runner) => ageRunner(runner, by)) },
  };
}

export function useAgedHomePage(page: HomePage): HomePage {
  const [clock, setClock] = useState({ page, sinceReceived: 0 });
  useEffect(() => {
    const receivedAt = Date.now();
    const timer = setInterval(() => {
      setClock({ page, sinceReceived: Date.now() - receivedAt });
    }, TIME_TEXT_TICK_MS);
    return () => clearInterval(timer);
  }, [page]);
  const sinceReceived = clock.page === page ? clock.sinceReceived : 0;
  return useMemo(() => agedHomePage(page, sinceReceived), [page, sinceReceived]);
}
