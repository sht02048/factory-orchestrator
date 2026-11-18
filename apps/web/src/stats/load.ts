import {
  getWorkspaceTrackerProject,
  listRunners,
  listRuns,
  listWorkspaces,
  toWorkspaceId,
} from "@factory/db";
import type { Database, StoredRun } from "@factory/db";
import { resolveWorkspace } from "../shell/model";
import { calendarDay } from "../time-zone";
import {
  dailyThroughput,
  groupStats,
  inPeriod,
  previousPeriod,
  statsPeriod,
  summarizeStats,
} from "./model";
import type { StatsPage, StatsPeriodDays, StatsRun } from "./model";

export function loadStatsPage(
  db: Database,
  ws: string | undefined,
  now: Date,
  timeZone: string,
  days: StatsPeriodDays,
): StatsPage {
  const workspace = resolveWorkspace(
    listWorkspaces(db).map((w) => ({ id: w.id, name: w.name })),
    ws,
  );
  if (workspace.kind !== "one") return { workspace };

  const period = statsPeriod(now, timeZone, days);
  const previous = previousPeriod(period);
  const runnerNames = new Map(listRunners(db).map((r) => [r.id, r.name]));
  const projectNames = new Map<string, string>();
  const projectName = (run: StoredRun): string => {
    const key = trackerProjectKey(run);
    let name = projectNames.get(key);
    if (name === undefined) {
      name =
        getWorkspaceTrackerProject(db, run.ticket.connection, run.trackerProject)?.name ??
        run.trackerProject;
      projectNames.set(key, name);
    }
    return name;
  };

  const current: StatsRun[] = [];
  const before: StatsRun[] = [];
  for (const run of listRuns(db, {
    workspaceId: toWorkspaceId(workspace.workspace.id),
    states: ["ended"],
  })) {
    if (run.state !== "ended") continue;
    const day = calendarDay(run.endedAt, timeZone);
    const bucket = inPeriod(day, period) ? current : inPeriod(day, previous) ? before : null;
    if (bucket === null) continue;
    bucket.push({
      runner:
        run.runnerId === null
          ? { key: "", name: "—" }
          : { key: run.runnerId, name: runnerNames.get(run.runnerId) ?? run.runnerId },
      trackerProject: {
        key: trackerProjectKey(run),
        name: projectName(run),
      },
      agent: { key: run.agent, name: run.agent },
      agentResult: run.agentResult,
      prState: run.prState,
      runnerUnreached: run.runnerUnreached,
      assignedAt: run.assignedAt,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
    });
  }

  return {
    workspace,
    period,
    total: summarizeStats(current),
    previous: summarizeStats(before),
    daily: dailyThroughput(current, period, timeZone),
    groups: {
      runner: groupStats(current, "runner"),
      trackerProject: groupStats(current, "trackerProject"),
      agent: groupStats(current, "agent"),
    },
  };
}

function trackerProjectKey(run: StoredRun): string {
  return `${encodeURIComponent(run.ticket.connection)}:${encodeURIComponent(run.trackerProject)}`;
}
