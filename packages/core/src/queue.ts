import { canRunnerTake, isProjectBlocked, pickRunner, remainingCapacity } from "./assignment.js";
import type { RunnerSnapshot, RunPlacement } from "./assignment.js";
import { priorityRank } from "./blockers.js";
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
  pinnedToRunner?: boolean;
  startRequested?: boolean;
  priorityRank?: number;
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
  const waitedOn = new Set<RunnerId>();

  for (const run of queueOrder(input.queued)) {
    if (run.unstartable) {
      if (run.runnerId === null || !waitedOn.has(run.runnerId)) plan.couldNotStart.push(run.id);
      continue;
    }

    let runnerId = run.runnerId;
    if (runnerId !== null) {
      const runner = runnersById.get(runnerId);
      if (run.pinnedToRunner === true) {
        const held = pinnedRunnerHold(runner, run);
        if (held !== null) {
          plan.unplaced.push({ runId: run.id, ...held });
          continue;
        }
      }
      if (runner === undefined || !canRunnerTake(runner, run.project)) {
        plan.cleared.push({
          runId: run.id,
          reason: runner === undefined ? "runner-offline" : whyCannotTake(runner, run.project),
        });
        runnerId = null;
      }
    }

    const hasRoom = (candidate: RunnerSnapshot): boolean =>
      !waitedOn.has(candidate.id) && remainingCapacity(candidate, placements) > 0;
    const choose = (runners: ReadonlyArray<RunnerSnapshot>): RunnerId | null =>
      pickRunner({ project: run.project, agent: run.agent, runners, runs: placements });

    if (runnerId === null) {
      runnerId = choose(input.runners.filter(hasRoom)) ?? choose(input.runners);
      if (runnerId === null) {
        plan.unplaced.push({ runId: run.id, ...unplacedReason(input.runners, run) });
        continue;
      }
      plan.assigned.push({ runId: run.id, runnerId });
    } else if (run.pinnedToRunner !== true && run.startRequested !== true) {
      const current = runnersById.get(runnerId);
      if (current !== undefined && !hasRoom(current)) {
        const freeRunner = choose(input.runners.filter(hasRoom));
        if (freeRunner !== null) {
          runnerId = freeRunner;
          plan.assigned.push({ runId: run.id, runnerId });
        }
      }
    }

    const runner = runnersById.get(runnerId);
    if (
      !waitedOn.has(runnerId) &&
      runner !== undefined &&
      remainingCapacity(runner, placements) > 0
    ) {
      plan.start.push({ runId: run.id, runnerId });
      placements.push({ runnerId, state: "running" });
    } else {
      waitedOn.add(runnerId);
    }
  }

  return plan;
}

function pinnedRunnerHold(
  runner: RunnerSnapshot | undefined,
  run: Pick<QueuedRun, "project" | "agent" | "startRequested">,
): Unplaced | null {
  if (runner === undefined) return { reason: "runner-offline" };
  if (!canRunnerTake(runner, run.project)) return { reason: whyCannotTake(runner, run.project) };
  if (run.startRequested === true) return null;
  const limit = usageLimitOf(runner.usageLimits, run.agent);
  return limit === null ? null : { reason: "usage-limit", limit };
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

const NO_PRIORITY_RANK = priorityRank("none");

export function queueOrder<T extends QueuedRun>(queued: ReadonlyArray<T>): T[] {
  return queued.toSorted(
    (a, b) =>
      Number(b.startRequested === true) - Number(a.startRequested === true) ||
      (a.priorityRank ?? NO_PRIORITY_RANK) - (b.priorityRank ?? NO_PRIORITY_RANK) ||
      a.assignedAt.getTime() - b.assignedAt.getTime(),
  );
}
