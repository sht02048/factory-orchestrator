import { runDurations, summarizeRunOutcome } from "@factory/core";
import type { QueuedRun, RunId } from "@factory/core";
import {
  getRunWithRecords,
  listPendingCancelRequests,
  listRunPermissionWaits,
  listRunQuestions,
  getWorkspaceTrackerProject,
  listRunPlacements,
  listRunnerSnapshots,
  listRunners,
  listRuns,
  listWorkspaces,
  toWorkspaceId,
} from "@factory/db";
import type { Database, StoredRun } from "@factory/db";
import { explainQueue } from "../runs/queue-reasons";
import { isWebUrl } from "../format/url";
import { resolveWorkspace, runnerIssueCause } from "../shell/model";
import { calendarDay } from "../time-zone";
import type { QueuedReason } from "../runs/model";
import type { DoneRun, HomePage, HomeRun, InputWait, RunnerIssue } from "./model";
import { partitionHome } from "./model";

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
      runners: { issues: [], online: 0 },
      doneToday: [],
    });

  const workspaceNames = new Map(workspaces.map((w) => [w.id, w]));
  const runners = new Map(listRunners(db).map((r) => [r.id, r]));
  const runs = listRuns(
    db,
    workspace.kind === "one" ? { workspaceId: toWorkspaceId(workspace.workspace.id) } : {},
  );

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
  const cancelling = new Set<string>(listPendingCancelRequests(db).map((r) => r.runId));

  const queuedReason = (id: RunId): QueuedReason => {
    const code = queueReasons.get(id) ?? { kind: "behind" };
    if (code.kind !== "no-capacity") return code;
    return { kind: "no-capacity", runner: runners.get(code.runnerId)?.name ?? code.runnerId };
  };

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

  const toView = (run: StoredRun): HomeRun => {
    const records = getRunWithRecords(db, run.id)?.records;
    const runner = run.runnerId === null ? undefined : runners.get(run.runnerId);
    const durations = runDurations({
      assignedAt: run.assignedAt,
      startedAt: run.state === "queued" ? null : run.startedAt,
      endedAt: run.state === "ended" ? run.endedAt : null,
      now,
    });
    const pr = records?.pullRequest;
    const base = {
      id: run.id,
      ticketKey: run.ticket.key,
      trackerProject: projectName(run),
      workspace: workspaceNames.get(run.workspaceId) ?? {
        id: run.workspaceId,
        name: run.workspaceId,
      },
      runner: runner === undefined ? null : { name: runner.name, online: runner.online },
      agent: run.agent,
      waitMs: durations.waitMs ?? 0,
      executionMs: durations.executionMs,
      pullRequest:
        pr === null || pr === undefined || !isWebUrl(pr.url)
          ? null
          : { displayId: pr.displayId, url: pr.url },
      cancelling: cancelling.has(run.id),
    };
    switch (run.state) {
      case "queued":
        return { ...base, state: run.state, queuedReason: queuedReason(run.id) };
      case "running":
        return { ...base, state: run.state };
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
        const since = records?.unreachableSince ?? null;
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
          prSettledLater: (records?.laterPrState ?? null) !== null,
        };
    }
  };

  const today = calendarDay(now, timeZone);
  const issues = [...runners.values()].flatMap((runner): RunnerIssue[] => {
    const cause = runnerIssueCause(runner);
    return cause === null ? [] : [{ id: runner.id, name: runner.name, cause }];
  });
  return partitionHome({
    workspace,
    runs: runs.map((run) => ({
      ticket: `${run.ticket.connection}\u0000${run.ticket.key}`,
      run: toView(run),
    })),
    runners: { issues, online: runners.size - issues.length },
    doneToday: runs.flatMap((run): DoneRun[] =>
      run.state === "ended" && calendarDay(run.endedAt, timeZone) === today
        ? [
            {
              id: run.id,
              ticketKey: run.ticket.key,
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
      input: {
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
