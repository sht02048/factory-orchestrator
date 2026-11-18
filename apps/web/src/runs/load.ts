import { AGENT_RESULTS, PR_STATES, runDurations, summarizeRunOutcome } from "@factory/core";
import type { QueuedRun, RunId } from "@factory/core";
import {
  getWorkspaceTrackerProject,
  listPendingCancelRequests,
  listRunPlacements,
  listRunnerSnapshots,
  listRuns,
  listRunsWithRecords,
  listRunners,
  listWorkspaces,
  toWorkspaceId,
} from "@factory/db";
import type { Database, EndedAxesFilter, RunRecords, StoredRun } from "@factory/db";
import { isWebUrl } from "../format/url";
import { resolveWorkspace } from "../shell/model";
import { ENDED_RUNS_PAGE_SIZE } from "./model";
import type { QueuedReason, RunView, RunsPage } from "./model";
import { explainQueue } from "./queue-reasons";

export function loadRunsPage(
  db: Database,
  ws: string | undefined,
  now: Date,
  endedLimit: number = ENDED_RUNS_PAGE_SIZE,
): RunsPage {
  const workspace = resolveWorkspace(
    listWorkspaces(db).map((w) => ({ id: w.id, name: w.name })),
    ws,
  );
  if (workspace.kind !== "one") return { workspace, runs: [], recentEnded: 0, moreEnded: false };

  const runners = new Map(listRunners(db).map((r) => [r.id, r]));
  const cancelling = new Set<RunId>(listPendingCancelRequests(db).map((r) => r.runId));
  const queueReasons = explainQueue({
    queued: listRuns(db, { states: ["queued"] }).flatMap((run): QueuedRun[] =>
      run.state === "queued"
        ? [
            {
              id: run.id,
              assignedAt: run.assignedAt,
              project: run.runnerProject,
              runnerId: run.runnerId,
              unstartable: false,
            },
          ]
        : [],
    ),
    runners: listRunnerSnapshots(db),
    runs: listRunPlacements(db),
  });

  const projectNames = new Map<string, string>();
  const projectName = (run: StoredRun): string => {
    const key = `${run.ticket.connection}\u0000${run.trackerProject}`;
    let name = projectNames.get(key);
    if (name === undefined) {
      name =
        getWorkspaceTrackerProject(db, run.ticket.connection, run.trackerProject)?.name ??
        run.trackerProject;
      projectNames.set(key, name);
    }
    return name;
  };

  const queuedReason = (id: RunId): QueuedReason => {
    const code = queueReasons.get(id) ?? { kind: "behind" };
    if (code.kind !== "no-capacity") return code;
    return { kind: "no-capacity", runner: runners.get(code.runnerId)?.name ?? code.runnerId };
  };

  const workspaceId = toWorkspaceId(workspace.workspace.id);
  const active = listRunsWithRecords(db, { workspaceId, states: ACTIVE_STATES, order: "newest" });
  const ended = listRunsWithRecords(db, {
    workspaceId,
    states: ["ended"],
    order: "newest",
    limit: endedLimit + 1,
  });
  const moreEnded = ended.length > endedLimit;
  const recentEnded = ended.slice(0, endedLimit);
  const recentEndedIds = new Set(recentEnded.map(({ run }) => run.id));
  const olderAttention = moreEnded
    ? listRunsWithRecords(db, {
        workspaceId,
        latestPerTicket: true,
        endedAxes: UNRESOLVED_ENDED_AXES,
      }).filter(({ run }) => !recentEndedIds.has(run.id))
    : [];
  const stored = [...active, ...recentEnded, ...olderAttention].toSorted(newestFirst);
  const latestByTicket = new Map<string, RunId>();
  for (const { run } of stored.toReversed())
    latestByTicket.set(`${run.ticket.connection}\u0000${run.ticket.key}`, run.id);

  const runs = stored.map(({ run, records }): RunView => {
    const runner = run.runnerId === null ? undefined : runners.get(run.runnerId);
    const startedAt = run.state === "queued" ? null : run.startedAt;
    const durations = runDurations({
      assignedAt: run.assignedAt,
      startedAt,
      endedAt: run.state === "ended" ? run.endedAt : null,
      now,
    });
    const pr = records.pullRequest;
    const base = {
      id: run.id,
      ticketKey: run.ticket.key,
      trackerProject: projectName(run),
      branch: run.state === "queued" ? null : run.branch,
      runner: runner === undefined ? null : { name: runner.name, online: runner.online },
      agent: run.agent,
      waitMs: durations.waitMs ?? 0,
      executionMs: durations.executionMs,
      pullRequest:
        pr === null || pr === undefined || !isWebUrl(pr.url)
          ? null
          : { displayId: pr.displayId, url: pr.url },
      attention: false,
    };
    switch (run.state) {
      case "queued":
        return {
          ...base,
          state: run.state,
          queuedReason: queuedReason(run.id),
          cancelling: cancelling.has(run.id),
        };
      case "running":
        return { ...base, state: run.state, cancelling: cancelling.has(run.id) };
      case "waiting-for-input":
      case "disconnected":
        return {
          ...base,
          state: run.state,
          cancelling: cancelling.has(run.id),
          attention: true,
        };
      case "ended": {
        const summary = summarizeRunOutcome(run).outcome;
        const latest =
          latestByTicket.get(`${run.ticket.connection}\u0000${run.ticket.key}`) === run.id;
        return {
          ...base,
          state: run.state,
          endedAt: run.endedAt.toISOString(),
          endedAgoMs: Math.max(0, now.getTime() - run.endedAt.getTime()),
          agentResult: run.agentResult,
          prState: run.prState,
          summary,
          attention: latest && isUnresolvedEndedRun(run, records),
        };
      }
    }
  });

  return { workspace, runs, recentEnded: recentEnded.length, moreEnded };
}

function isUnresolvedEndedRun(run: StoredRun, records: RunRecords): boolean {
  if (run.state !== "ended") return false;
  const summary = summarizeRunOutcome(run).outcome;
  return summary === "failed" || (summary === "human-check" && records.laterPrState === null);
}

const UNRESOLVED_ENDED_AXES: ReadonlyArray<EndedAxesFilter> = AGENT_RESULTS.flatMap((agentResult) =>
  PR_STATES.flatMap((prState): EndedAxesFilter[] => {
    switch (summarizeRunOutcome({ agentResult, prState, runnerUnreached: false }).outcome) {
      case "failed":
        return [{ agentResult, prState }];
      case "human-check":
        return [{ agentResult, prState, laterPrState: null }];
      case "merged":
      case "canceled":
        return [];
    }
  }),
);

const ACTIVE_STATES = ["queued", "running", "waiting-for-input", "disconnected"] as const;

function newestFirst(
  a: { run: StoredRun; records: RunRecords },
  b: { run: StoredRun; records: RunRecords },
): number {
  const byTime = b.run.assignedAt.getTime() - a.run.assignedAt.getTime();
  if (byTime !== 0) return byTime;
  return a.run.id < b.run.id ? 1 : a.run.id > b.run.id ? -1 : 0;
}
