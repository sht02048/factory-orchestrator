import type { LabelId, RunnerId, RunnerProjectId } from "./ids.js";
import { ACTIVE_RUN_STATES, CAPACITY_OCCUPYING_STATES } from "./run.js";
import type { RunState } from "./run.js";

/** 할당과 대기열 판단에 쓰는 러너 하나의 모습 */
export interface RunnerSnapshot {
  id: RunnerId;
  online: boolean;
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
  | { ok: false; reason: "no-auto-assign-label" | "active-run" };

/**
 * 티켓당 동시에 도는 런은 하나다(Q45·Q74). 수동 할당과 자동 할당이 함께 쓴다.
 * Queued, Running, Waiting for Input, Disconnected 런이 있으면 할당하지 않는다.
 */
export function checkAssignment(input: {
  runsForTicket: ReadonlyArray<{ state: RunState }>;
}): AssignmentCheck {
  const hasActiveRun = input.runsForTicket.some((run) => ACTIVE_RUN_STATES.has(run.state));
  return hasActiveRun ? { ok: false, reason: "active-run" } : { ok: true };
}

/** 자동 할당 조건: 티켓에 Auto-assign Label이 있고 동시에 도는 런이 없다(스펙 3.2). */
export function checkAutoAssignment(input: {
  labelIds: ReadonlyArray<LabelId>;
  autoAssignLabelId: LabelId;
  runsForTicket: ReadonlyArray<{ state: RunState }>;
}): AssignmentCheck {
  if (!input.labelIds.includes(input.autoAssignLabelId)) {
    return { ok: false, reason: "no-auto-assign-label" };
  }
  return checkAssignment(input);
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
 * 할당 때의 러너 고르기(Q53). 러너 쪽 프로젝트가 있는 Online 러너 중 남은 capacity가 가장 많은
 * 러너를 고른다. 남은 capacity가 같으면 `runners`에서 앞에 있는 러너를 고른다.
 * 남은 capacity가 0이어도 고른다(대기열에서 기다린다). 맞는 러너가 모두 Offline이면 null이다(Q65).
 */
export function pickRunner(input: {
  project: RunnerProjectId;
  runners: ReadonlyArray<RunnerSnapshot>;
  runs: ReadonlyArray<RunPlacement>;
}): RunnerId | null {
  let best: { id: RunnerId; remaining: number } | null = null;
  for (const runner of input.runners) {
    if (!runner.online || !runner.projects.includes(input.project)) continue;
    const remaining = remainingCapacity(runner, input.runs);
    if (best === null || remaining > best.remaining) {
      best = { id: runner.id, remaining };
    }
  }
  return best?.id ?? null;
}
