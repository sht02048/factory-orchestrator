import {
  getRunWithRecords,
  getWorkspaceTrackerProject,
  listRunners,
  listRuns,
  listWorkspaces,
  toWorkspaceId,
} from "@factory/db";
import type { Database, StoredRun } from "@factory/db";
import { resolveWorkspace } from "../shell/model";
import { calendarDay } from "../time-zone";
import { dailyThroughput, groupStats, statsPeriod, summarizeStats } from "./model";
import type { StatsPage, StatsRun } from "./model";

export function loadStatsPage(
  db: Database,
  ws: string | undefined,
  now: Date,
  timeZone: string,
): StatsPage {
  const workspace = resolveWorkspace(
    listWorkspaces(db).map((w) => ({ id: w.id, name: w.name })),
    ws,
  );
  if (workspace.kind !== "one") return { workspace };

  const period = statsPeriod(now, timeZone);
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

  const runs = listRuns(db, {
    workspaceId: toWorkspaceId(workspace.workspace.id),
    states: ["ended"],
  }).flatMap((run): StatsRun[] => {
    if (run.state !== "ended") return [];
    const day = calendarDay(run.endedAt, timeZone);
    if (day < period.firstDay || day > period.lastDay) return [];
    const later = getRunWithRecords(db, run.id)?.records.laterPrState ?? null;
    return [
      {
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
        laterPrState: later?.state ?? null,
        assignedAt: run.assignedAt,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
      },
    ];
  });

  return {
    workspace,
    period,
    total: summarizeStats(runs),
    daily: dailyThroughput(runs, period, timeZone),
    groups: {
      runner: groupStats(runs, "runner"),
      trackerProject: groupStats(runs, "trackerProject"),
      agent: groupStats(runs, "agent"),
    },
  };
}

function trackerProjectKey(run: StoredRun): string {
  return `${encodeURIComponent(run.ticket.connection)}:${encodeURIComponent(run.trackerProject)}`;
}
