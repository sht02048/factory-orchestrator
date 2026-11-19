import type { AgentId, LabelId, RunnerId, RunnerProjectId } from "./ids.js";
import { ACTIVE_RUN_STATES, CAPACITY_OCCUPYING_STATES, sameTicket } from "./run.js";
import type { AgentResult, RunState, TicketRef } from "./run.js";
import { usageLimitOf } from "./usage-limit.js";
import type { UsageLimit } from "./usage-limit.js";

export interface RunnerSnapshot {
  id: RunnerId;
  online: boolean;
  assignmentBlocked: boolean;
  capacity: number;
  projects: ReadonlyArray<RunnerProjectId>;
  usageLimits: ReadonlyArray<UsageLimit>;
}

export interface RunPlacement {
  runnerId: RunnerId | null;
  state: RunState;
}

export type AssignmentCheck =
  | { ok: true }
  | { ok: false; reason: "no-auto-assign-label" | "active-run" | "canceled-by-operator" };

export function checkAssignment(input: {
  ticket: TicketRef;
  runs: ReadonlyArray<{ ticket: TicketRef; state: RunState }>;
}): AssignmentCheck {
  const hasActiveRun = input.runs.some(
    (run) => sameTicket(run.ticket, input.ticket) && ACTIVE_RUN_STATES.has(run.state),
  );
  return hasActiveRun ? { ok: false, reason: "active-run" } : { ok: true };
}

export interface AutoAssignmentRun {
  ticket: TicketRef;
  state: RunState;
  assignedAt: Date;
  agentResult: AgentResult | null;
  endedAt: Date | null;
}

export function checkAutoAssignment(input: {
  labelIds: ReadonlyArray<LabelId>;
  autoAssignLabelId: LabelId;
  labelAttachedAt: Date | null;
  ticket: TicketRef;
  runs: ReadonlyArray<AutoAssignmentRun>;
}): AssignmentCheck {
  if (!input.labelIds.includes(input.autoAssignLabelId)) {
    return { ok: false, reason: "no-auto-assign-label" };
  }
  const active = checkAssignment(input);
  if (!active.ok) return active;

  const last = lastRunOf(input.runs, input.ticket);
  if (last?.agentResult === "canceled" && last.endedAt !== null) {
    const reattached =
      input.labelAttachedAt !== null && input.labelAttachedAt.getTime() > last.endedAt.getTime();
    if (!reattached) return { ok: false, reason: "canceled-by-operator" };
  }
  return { ok: true };
}

function lastRunOf(
  runs: ReadonlyArray<AutoAssignmentRun>,
  ticket: TicketRef,
): AutoAssignmentRun | null {
  let last: AutoAssignmentRun | null = null;
  for (const run of runs) {
    if (!sameTicket(run.ticket, ticket)) continue;
    if (last === null || run.assignedAt.getTime() >= last.assignedAt.getTime()) last = run;
  }
  return last;
}

export function remainingCapacity(
  runner: Pick<RunnerSnapshot, "id" | "capacity">,
  runs: ReadonlyArray<RunPlacement>,
): number {
  const occupied = runs.filter(
    (run) => run.runnerId === runner.id && CAPACITY_OCCUPYING_STATES.has(run.state),
  ).length;
  return Math.max(0, runner.capacity - occupied);
}

export function canRunnerTake(runner: RunnerSnapshot, project: RunnerProjectId): boolean {
  return runner.online && !runner.assignmentBlocked && runner.projects.includes(project);
}

export function pickRunner(input: {
  project: RunnerProjectId;
  agent: AgentId;
  runners: ReadonlyArray<RunnerSnapshot>;
  runs: ReadonlyArray<RunPlacement>;
}): RunnerId | null {
  let best: { id: RunnerId; remaining: number } | null = null;
  for (const runner of input.runners) {
    if (!canRunnerTake(runner, input.project)) continue;
    if (usageLimitOf(runner.usageLimits, input.agent) !== null) continue;
    const remaining = remainingCapacity(runner, input.runs);
    if (best === null || remaining > best.remaining) {
      best = { id: runner.id, remaining };
    }
  }
  return best?.id ?? null;
}

export function checkManualRunnerChoice(
  runner: RunnerSnapshot,
): { ok: true } | { ok: false; reason: "assignment-blocked" } {
  return runner.assignmentBlocked ? { ok: false, reason: "assignment-blocked" } : { ok: true };
}
