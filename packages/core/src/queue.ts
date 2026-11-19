import { canRunnerTake, isProjectBlocked, pickRunner, remainingCapacity } from "./assignment.js";
import type { RunnerSnapshot, RunPlacement } from "./assignment.js";
import type { AgentId, RunId, RunnerId, RunnerProjectId } from "./ids.js";
import { usageLimitOf } from "./usage-limit.js";
import type { UsageLimit } from "./usage-limit.js";

export interface QueuedRun {
  id: RunId;
  assignedAt: Date;
  project: RunnerProjectId;
  agent: AgentId;
  runnerId: RunnerId | null;
  unstartable: boolean;
}

export interface RunnerChoice {
  runId: RunId;
  runnerId: RunnerId;
}

export type UnplacedReason = "runner-offline" | "assignment-blocked" | "project-missing";

export type Unplaced = { reason: UnplacedReason } | { reason: "usage-limit"; limit: UsageLimit };

export interface QueuePlan {
  cleared: Array<{ runId: RunId; reason: UnplacedReason }>;
  assigned: RunnerChoice[];
  unplaced: Array<{ runId: RunId } & Unplaced>;
  couldNotStart: RunId[];
  start: RunnerChoice[];
}

export function planQueue(input: {
  queued: ReadonlyArray<QueuedRun>;
  runners: ReadonlyArray<RunnerSnapshot>;
  runs: ReadonlyArray<RunPlacement>;
}): QueuePlan {
  const plan: QueuePlan = { cleared: [], assigned: [], unplaced: [], couldNotStart: [], start: [] };
  const runnersById = new Map(input.runners.map((runner) => [runner.id, runner]));
  const placements: RunPlacement[] = [...input.runs];
  let blocked = false;

  for (const run of fifoOrder(input.queued)) {
    if (run.unstartable) {
      if (!blocked) plan.couldNotStart.push(run.id);
      continue;
    }

    let runnerId = run.runnerId;
    if (runnerId !== null) {
      const runner = runnersById.get(runnerId);
      if (runner === undefined || !canRunnerTake(runner, run.project)) {
        plan.cleared.push({
          runId: run.id,
          reason: runner === undefined ? "runner-offline" : whyCannotTake(runner, run.project),
        });
        runnerId = null;
      }
    }

    if (runnerId === null) {
      runnerId = pickRunner({
        project: run.project,
        agent: run.agent,
        runners: input.runners,
        runs: placements,
      });
      if (runnerId === null) {
        plan.unplaced.push({ runId: run.id, ...unplacedReason(input.runners, run) });
        continue;
      }
      plan.assigned.push({ runId: run.id, runnerId });
    }

    if (blocked) continue;

    const runner = runnersById.get(runnerId);
    if (runner !== undefined && remainingCapacity(runner, placements) > 0) {
      plan.start.push({ runId: run.id, runnerId });
      placements.push({ runnerId, state: "running" });
    } else {
      blocked = true;
    }
  }

  return plan;
}

function whyCannotTake(runner: RunnerSnapshot, project: RunnerProjectId): UnplacedReason {
  if (!runner.projects.includes(project)) return "project-missing";
  if (!runner.online) return "runner-offline";
  return "assignment-blocked";
}

function unplacedReason(
  runners: ReadonlyArray<RunnerSnapshot>,
  run: Pick<QueuedRun, "project" | "agent">,
): Unplaced {
  const withProject = runners.filter((runner) => runner.projects.includes(run.project));
  if (withProject.length === 0) return { reason: "project-missing" };
  const online = withProject.filter((runner) => runner.online);
  if (online.length === 0) return { reason: "runner-offline" };
  const limits = online
    .filter((runner) => !runner.assignmentBlocked && !isProjectBlocked(runner, run.project))
    .flatMap((runner) => {
      const limit = usageLimitOf(runner.usageLimits, run.agent);
      return limit === null ? [] : [limit];
    });
  const earliest = limits.toSorted((a, b) => a.until.getTime() - b.until.getTime())[0];
  return earliest === undefined
    ? { reason: "assignment-blocked" }
    : { reason: "usage-limit", limit: earliest };
}

function fifoOrder(queued: ReadonlyArray<QueuedRun>): QueuedRun[] {
  return queued.toSorted((a, b) => a.assignedAt.getTime() - b.assignedAt.getTime());
}
