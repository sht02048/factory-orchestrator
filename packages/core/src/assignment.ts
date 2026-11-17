import type { LabelId, RunnerId, RunnerProjectId } from "./ids.js";
import { ACTIVE_RUN_STATES, CAPACITY_OCCUPYING_STATES, sameTicket } from "./run.js";
import type { AgentResult, RunState, TicketRef } from "./run.js";

/** 할당과 대기열 판단에 쓰는 러너 하나의 모습 */
export interface RunnerSnapshot {
  id: RunnerId;
  online: boolean;
  /**
   * 러너 확인에서 할당을 막는 필수 조건이 깨졌는지(isAssignmentBlocked). 1단계에서는 러너의 GitHub 인증이
   * 깨진 경우다(Q82.14). 러너 고르기에서 빠지지만 Online/Offline은 그대로다.
   */
  assignmentBlocked: boolean;
  capacity: number;
  /** 그 러너에 등록된 러너 쪽 프로젝트 */
  projects: ReadonlyArray<RunnerProjectId>;
}

/** capacity를 셀 때 보는 런 하나. 러너를 정하지 않은 Queued 런은 runnerId가 null이다. */
export interface RunPlacement {
  runnerId: RunnerId | null;
  state: RunState;
}

export type AssignmentCheck =
  | { ok: true }
  | { ok: false; reason: "no-auto-assign-label" | "active-run" | "canceled-by-operator" };

/**
 * 티켓당 동시에 도는 런은 하나다(Q45·Q74). 수동 할당과 자동 할당이 함께 쓴다.
 * 같은 티켓(트래커 연결과 티켓 키가 모두 같음)에 Queued, Running, Waiting for Input,
 * Disconnected 런이 있으면 할당하지 않는다. 다른 트래커 연결의 같은 키는 다른 티켓이다.
 */
export function checkAssignment(input: {
  ticket: TicketRef;
  runs: ReadonlyArray<{ ticket: TicketRef; state: RunState }>;
}): AssignmentCheck {
  const hasActiveRun = input.runs.some(
    (run) => sameTicket(run.ticket, input.ticket) && ACTIVE_RUN_STATES.has(run.state),
  );
  return hasActiveRun ? { ok: false, reason: "active-run" } : { ok: true };
}

/** 자동 할당 조건이 보는 런 하나. Ended가 아니면 agentResult·endedAt은 null이다. */
export interface AutoAssignmentRun {
  ticket: TicketRef;
  state: RunState;
  assignedAt: Date;
  agentResult: AgentResult | null;
  endedAt: Date | null;
}

/**
 * 자동 할당 조건(스펙 3절 2번).
 * 1. 티켓에 Auto-assign Label이 있다.
 * 2. 동시에 도는 런이 없다(Q45·Q74).
 * 3. 그 티켓의 마지막 런을 운영자가 취소했으면, 취소한 뒤 라벨이 다시 붙었어야 한다(Q82.12).
 *    `labelAttachedAt`은 라벨이 마지막으로 붙은 시각이고, 모르면(폴링 보정 등) null이다.
 *    모르면 다시 붙었다는 증거가 없으니 할당하지 않는다. 수동 할당은 이 조건을 보지 않는다(checkAssignment).
 */
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

/** 러너의 capacity에서 Running·Waiting for Input·Disconnected 런을 뺀 값(Q74). */
export function remainingCapacity(
  runner: Pick<RunnerSnapshot, "id" | "capacity">,
  runs: ReadonlyArray<RunPlacement>,
): number {
  const occupied = runs.filter(
    (run) => run.runnerId === runner.id && CAPACITY_OCCUPYING_STATES.has(run.state),
  ).length;
  return Math.max(0, runner.capacity - occupied);
}

/**
 * 러너가 그 런을 받을 수 있는지(Q53·Q78·Q82.14): Online이고, 할당을 막는 필수 조건이 깨지지 않았고,
 * 그 러너 쪽 프로젝트가 있다.
 */
export function canRunnerTake(runner: RunnerSnapshot, project: RunnerProjectId): boolean {
  return runner.online && !runner.assignmentBlocked && runner.projects.includes(project);
}

/**
 * 할당 때의 러너 고르기(Q53). 러너 쪽 프로젝트가 있는 Online 러너 중 GitHub 인증이 깨지지 않았고
 * (Q82.14) 남은 capacity가 가장 많은 러너를 고른다. 남은 capacity가 같으면 `runners`에서 앞에 있는
 * 러너를 고른다. 남은 capacity가 0이어도 고른다(대기열에서 기다린다).
 * 맞는 러너가 없으면 null이다(Q65). 모두 인증이 깨졌어도 할당은 받아 러너 없이 Queued로 둔다(Q87).
 */
export function pickRunner(input: {
  project: RunnerProjectId;
  runners: ReadonlyArray<RunnerSnapshot>;
  runs: ReadonlyArray<RunPlacement>;
}): RunnerId | null {
  let best: { id: RunnerId; remaining: number } | null = null;
  for (const runner of input.runners) {
    if (!canRunnerTake(runner, input.project)) continue;
    const remaining = remainingCapacity(runner, input.runs);
    if (best === null || remaining > best.remaining) {
      best = { id: runner.id, remaining };
    }
  }
  return best?.id ?? null;
}

/**
 * 수동 할당에서 운영자가 고를 수 있는 러너인지(Q87). 할당을 막는 필수 조건이 깨진 러너는 목록에
 * 비활성으로 보이고 고를 수 없다. 그 밖의 러너(Offline 포함)는 고를 수 있다.
 */
export function checkManualRunnerChoice(
  runner: RunnerSnapshot,
): { ok: true } | { ok: false; reason: "assignment-blocked" } {
  return runner.assignmentBlocked ? { ok: false, reason: "assignment-blocked" } : { ok: true };
}
