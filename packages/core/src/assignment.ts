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
  blockedProjects?: ReadonlyArray<RunnerProjectId>;
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

export function isProjectBlocked(
  runner: Pick<RunnerSnapshot, "blockedProjects">,
  project: RunnerProjectId,
): boolean {
  return runner.blockedProjects?.includes(project) ?? false;
}

export function canRunnerTake(runner: RunnerSnapshot, project: RunnerProjectId): boolean {
  return (
    runner.online &&
    !runner.assignmentBlocked &&
    runner.projects.includes(project) &&
    !isProjectBlocked(runner, project)
  );
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
  project: RunnerProjectId,
): { ok: true } | { ok: false; reason: "assignment-blocked" } {
  return runner.assignmentBlocked || isProjectBlocked(runner, project)
    ? { ok: false, reason: "assignment-blocked" }
    : { ok: true };
}

export interface MappingRepo {
  project: RunnerProjectId;
  isDefault: boolean;
  labelId: LabelId | null;
}

export function defaultRepoOf(repos: ReadonlyArray<MappingRepo>): RunnerProjectId | null {
  return repos.find((repo) => repo.isDefault)?.project ?? null;
}

export function routeToRepo(
  repos: ReadonlyArray<MappingRepo>,
  ticketLabelIds: ReadonlyArray<LabelId>,
): RunnerProjectId | null {
  const matching = repos.filter(
    (repo) => !repo.isDefault && repo.labelId !== null && ticketLabelIds.includes(repo.labelId),
  );
  const [only, ...others] = matching;
  if (only !== undefined && others.length === 0) return only.project;
  return defaultRepoOf(repos);
}

export type MappingReposProblem =
  | "no-repos"
  | "no-default"
  | "many-defaults"
  | "default-has-label"
  | "duplicate-repo"
  | "label-in-use";

export function checkMappingRepos(
  repos: ReadonlyArray<MappingRepo>,
): { ok: true } | { ok: false; reason: MappingReposProblem } {
  if (repos.length === 0) return { ok: false, reason: "no-repos" };
  const defaults = repos.filter((repo) => repo.isDefault).length;
  if (defaults === 0) return { ok: false, reason: "no-default" };
  if (defaults > 1) return { ok: false, reason: "many-defaults" };
  if (repos.some((repo) => repo.isDefault && repo.labelId !== null)) {
    return { ok: false, reason: "default-has-label" };
  }
  if (new Set(repos.map((repo) => repo.project)).size !== repos.length) {
    return { ok: false, reason: "duplicate-repo" };
  }
  const labels = repos.flatMap((repo) => (repo.labelId === null ? [] : [repo.labelId]));
  if (new Set(labels).size !== labels.length) return { ok: false, reason: "label-in-use" };
  return { ok: true };
}

export const AUTO_ASSIGN_LABEL_NAME = "ganger";

export function findLabelNamed<L extends { name: string }>(
  labels: ReadonlyArray<L>,
  name: string,
): L | null {
  const wanted = name.trim().toLocaleLowerCase();
  return labels.find((label) => label.name.trim().toLocaleLowerCase() === wanted) ?? null;
}
