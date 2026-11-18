import { summarizeRunOutcome } from "@ganger/core";
import { getRunWithRecords, listRunners, listRuns, listWorkspaces } from "@ganger/db";
import type { Database, StoredRun } from "@ganger/db";
import { z } from "zod";
import { prerequisiteHint, prerequisiteProject } from "../labels";
import type {
  LeftWorktree,
  OccupyingRun,
  RunWorkspace,
  RunnerView,
  RunnersPage,
  QueuedRunView,
} from "./model";

const runnerConfigSchema = z.object({
  sshTarget: z.string().min(1).optional().catch(undefined),
});

export function loadRunnersPage(db: Database, now: Date): RunnersPage {
  const workspaces = new Map(listWorkspaces(db).map((w) => [w.id, { id: w.id, name: w.name }]));
  const workspaceOf = (run: StoredRun): RunWorkspace =>
    workspaces.get(run.workspaceId) ?? { id: run.workspaceId, name: run.workspaceId };

  const occupying = new Map<string, OccupyingRun[]>();
  const queued = new Map<string, QueuedRunView[]>();
  const leftWorktrees = new Map<string, LeftWorktree[]>();
  const push = <T>(map: Map<string, T[]>, runnerId: string, item: T) => {
    const list = map.get(runnerId);
    if (list === undefined) map.set(runnerId, [item]);
    else list.push(item);
  };

  for (const run of listRuns(db)) {
    if (run.runnerId === null) continue;
    const base = { id: run.id, ticketKey: run.ticket.key, workspace: workspaceOf(run) };
    switch (run.state) {
      case "queued":
        push(queued, run.runnerId, { ...base, waitMs: now.getTime() - run.assignedAt.getTime() });
        break;
      case "running":
      case "waiting-for-input":
      case "disconnected":
        push(occupying, run.runnerId, {
          ...base,
          state: run.state,
          executionMs: now.getTime() - run.startedAt.getTime(),
        });
        break;
      case "ended": {
        const { worktree } = summarizeRunOutcome(run);
        if (worktree !== "keep-until-pr-settles" && worktree !== "operator-decides") break;
        if (getRunWithRecords(db, run.id)?.records.worktreeRemovedAt !== null) break;
        push(leftWorktrees, run.runnerId, { ...base, worktree });
        break;
      }
    }
  }

  const runners = listRunners(db).map((runner): RunnerView => {
    const parsed = runnerConfigSchema.safeParse(runner.config);
    const config = parsed.success ? parsed.data : {};
    return {
      id: runner.id,
      name: runner.name,
      online: runner.online,
      assignmentBlocked: runner.assignmentBlocked,
      checks:
        runner.prerequisites?.map((p) => ({
          id: p.id,
          name: p.name,
          project: prerequisiteProject(p.id, runner.projects),
          satisfied: p.satisfied,
          blocksAssignment: p.blocksAssignment,
          hint: prerequisiteHint(p),
        })) ?? null,
      checked:
        runner.checkedAt === null
          ? null
          : {
              at: runner.checkedAt.toISOString(),
              agoMs: now.getTime() - runner.checkedAt.getTime(),
            },
      capacity: runner.capacity,
      occupying: (occupying.get(runner.id) ?? []).toSorted((a, b) => b.executionMs - a.executionMs),
      queued: queued.get(runner.id) ?? [],
      leftWorktrees: leftWorktrees.get(runner.id) ?? [],
      sshTarget: config.sshTarget ?? null,
    };
  });
  return { runners };
}
