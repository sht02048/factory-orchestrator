import {
  currentWindows,
  highestUsage,
  reachedUsageLimits,
  runDurations,
  summarizeRunOutcome,
} from "@ganger/core";
import type { QueuedRun, RunId } from "@ganger/core";
import {
  listPendingCancelRequests,
  listRunPermissionWaits,
  listRunQuestions,
  getWorkspaceTrackerProject,
  listRunPlacements,
  listRunnerSnapshots,
  listRunners,
  listRuns,
  listRunsWithRecords,
  listWorkspaces,
  toWorkspaceId,
} from "@ganger/db";
import type { Database, RunRecords, StoredRun, StoredRunner } from "@ganger/db";
import { runControlOf, withoutPauses } from "../run-control.js";
import { describeQueuedReason, explainQueue } from "../runs/queue-reasons.js";
import { isWebUrl } from "../format/url.js";
import { resolveWorkspace, runnerIssueCause } from "../shell/model.js";
import { calendarDay } from "../time-zone.js";
import { ticketId } from "../tickets/load.js";
import type { QueuedReason } from "../runs/model.js";
import type { DashboardRunner, DoneRun, HomePage, HomeRun, InputWait } from "./model.js";
import { partitionHome } from "./model.js";

export function loadHomePage(
  db: Database,
  ws: string | undefined,
  now: Date,
  timeZone: string,
): HomePage {
  const workspaces = listWorkspaces(db).map((w) => ({ id: w.id, name: w.name }));
  const workspace = resolveWorkspace(workspaces, ws);
  if (workspace.kind === "none")
    return partitionHome({
      workspace,
      runs: [],
      runners: { list: [] },
      doneToday: [],
      endedToday: [],
    });

  const workspaceNames = new Map(workspaces.map((w) => [w.id, w]));
  const runners = new Map(listRunners(db).map((r) => [r.id, r]));
  const runsWithRecords = listRunsWithRecords(
    db,
    workspace.kind === "one" ? { workspaceId: toWorkspaceId(workspace.workspace.id) } : {},
  );
  const runs = runsWithRecords.map(({ run }) => run);

  const placements = listRunPlacements(db);
  const queueReasons = explainQueue({
    queued: listRuns(db, { states: ["queued"] }).flatMap((run): QueuedRun[] =>
      run.state === "queued"
        ? [
            {
              id: run.id,
              assignedAt: run.assignedAt,
              project: run.runnerProject,
              agent: run.agent,
              runnerId: run.runnerId,
              unstartable: false,
            },
          ]
        : [],
    ),
    runners: listRunnerSnapshots(db, now),
    runs: placements,
  });
  const cancelling = new Set<string>(listPendingCancelRequests(db).map((r) => r.runId));

  const queuedReason = (id: RunId): QueuedReason =>
    describeQueuedReason(
      queueReasons.get(id) ?? { kind: "behind" },
      (runnerId) => runners.get(runnerId)?.name ?? runnerId,
      now,
    );

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

  const toView = (run: StoredRun, records: RunRecords): HomeRun => {
    const runner = run.runnerId === null ? undefined : runners.get(run.runnerId);
    const durations = runDurations({
      assignedAt: run.assignedAt,
      startedAt: run.state === "queued" ? null : run.startedAt,
      endedAt: run.state === "ended" ? run.endedAt : null,
      now,
    });
    const pr = records.pullRequest;
    const base = {
      id: run.id,
      ticketId: ticketId(run.ticket.connection, run.ticket.key),
      ticketKey: run.ticket.key,
      ticketTitle: run.ticketTitle,
      trackerProject: projectName(run),
      workspace: workspaceNames.get(run.workspaceId) ?? {
        id: run.workspaceId,
        name: run.workspaceId,
      },
      runner: runner === undefined ? null : { name: runner.name, online: runner.online },
      agent: run.agent,
      waitMs: durations.waitMs ?? 0,
      executionMs: withoutPauses(durations.executionMs, records, now),
      pullRequest:
        pr === null || !isWebUrl(pr.url) ? null : { displayId: pr.displayId, url: pr.url },
      cancelling: cancelling.has(run.id),
      control:
        run.state === "running" || run.state === "paused" ? runControlOf(db, run, now) : null,
    };
    switch (run.state) {
      case "queued":
        return { ...base, state: run.state, queuedReason: queuedReason(run.id) };
      case "running":
        return { ...base, state: run.state };
      case "paused": {
        const since = records.pausedSince;
        return {
          ...base,
          state: run.state,
          pauseSource: records.pauseSource ?? "operator",
          pausedMs: since === null ? null : Math.max(0, now.getTime() - since.getTime()),
        };
      }
      case "waiting-for-input": {
        const pending = oldestPendingInput(db, run.id);
        return {
          ...base,
          state: run.state,
          input: pending?.input ?? null,
          waitingMs: pending === null ? null : Math.max(0, now.getTime() - pending.at.getTime()),
        };
      }
      case "disconnected": {
        const since = records.unreachableSince;
        return {
          ...base,
          state: run.state,
          unreachableMs: since === null ? null : Math.max(0, now.getTime() - since.getTime()),
        };
      }
      case "ended":
        return {
          ...base,
          state: run.state,
          agentResult: run.agentResult,
          prState: run.prState,
          summary: summarizeRunOutcome(run).outcome,
          endedAt: run.endedAt.toISOString(),
          endedAgoMs: Math.max(0, now.getTime() - run.endedAt.getTime()),
        };
    }
  };

  const today = calendarDay(now, timeZone);
  const used = new Map<string, number>();
  for (const placement of placements) {
    if (placement.runnerId === null || placement.state === "queued") continue;
    used.set(placement.runnerId, (used.get(placement.runnerId) ?? 0) + 1);
  }
  const dashboardRunners = [...runners.values()]
    .map((runner): DashboardRunner => ({
      id: runner.id,
      name: runner.name,
      cause: runnerIssueCause(runner),
      offlineMs:
        runner.online || runner.offlineSince === null
          ? null
          : Math.max(0, now.getTime() - runner.offlineSince.getTime()),
      used: used.get(runner.id) ?? 0,
      capacity: runner.capacity,
      ...dashboardUsage(runner, now),
    }))
    .toSorted((a, b) => Number(a.cause === null) - Number(b.cause === null));
  const endedToday = (run: StoredRun): boolean =>
    run.state === "ended" && calendarDay(run.endedAt, timeZone) === today;
  const views = runsWithRecords.map(({ run, records }) => ({
    ticket: `${run.ticket.connection}\u0000${run.ticket.key}`,
    run: toView(run, records),
    endedToday: endedToday(run),
  }));
  return partitionHome({
    workspace,
    runs: views,
    endedToday: views.flatMap((view) => (view.endedToday ? [view.run] : [])),
    runners: { list: dashboardRunners },
    doneToday: runs.flatMap((run): DoneRun[] =>
      run.state === "ended" && endedToday(run)
        ? [
            {
              id: run.id,
              ticketKey: run.ticket.key,
              ticketTitle: run.ticketTitle,
              workspace: workspaceNames.get(run.workspaceId) ?? {
                id: run.workspaceId,
                name: run.workspaceId,
              },
              summary: summarizeRunOutcome(run).outcome,
              endedAt: run.endedAt.toISOString(),
              endedAgoMs: Math.max(0, now.getTime() - run.endedAt.getTime()),
            },
          ]
        : [],
    ),
  });
}

export function pendingInput(db: Database, runId: RunId): InputWait | null {
  return oldestPendingInput(db, runId)?.input ?? null;
}

function oldestPendingInput(db: Database, runId: RunId): { at: Date; input: InputWait } | null {
  const inputs: Array<{ at: Date; input: InputWait }> = [];
  for (const q of listRunQuestions(db, runId)) {
    if (q.answer !== null && q.answer.sentAt !== null) continue;
    inputs.push({
      at: q.askedAt,
      input:
        q.kind === "human-check"
          ? {
              kind: "human-check",
              questionId: q.id,
              body: q.body,
              answered: q.answer !== null,
            }
          : {
              kind: "question",
              questionId: q.id,
              body: q.body,
              choices: q.options,
              answered: q.answer !== null,
            },
    });
  }
  for (const wait of listRunPermissionWaits(db, runId)) {
    if (wait.resolvedAt !== null || (wait.denial !== null && wait.denial.sentAt !== null)) continue;
    inputs.push({
      at: wait.requestedAt,
      input: {
        kind: "permission",
        promptId: wait.id,
        detail: wait.detail,
        denied: wait.denial !== null,
      },
    });
  }
  return inputs.toSorted((a, b) => a.at.getTime() - b.at.getTime())[0] ?? null;
}

function dashboardUsage(
  runner: StoredRunner,
  now: Date,
): Pick<DashboardRunner, "usage" | "limits"> {
  const reading = runner.providerUsage?.reading;
  if (reading?.kind !== "read") return { usage: null, limits: [] };
  const providers = currentWindows(reading.providers, now);
  const highest = highestUsage(providers);
  return {
    usage:
      highest === null
        ? null
        : {
            provider: highest.provider,
            window: highest.window.kind,
            usedPercent: highest.window.usedPercent,
          },
    limits: runner.online
      ? reachedUsageLimits(providers).map(({ provider, window }) => ({
          provider,
          window: window.kind,
          resetsInMs:
            window.resetsAt === null
              ? null
              : Math.max(0, window.resetsAt.getTime() - now.getTime()),
        }))
      : [],
  };
}
