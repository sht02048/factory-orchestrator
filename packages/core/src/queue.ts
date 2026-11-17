import { pickRunner, remainingCapacity } from "./assignment.js";
import type { RunnerSnapshot, RunPlacement } from "./assignment.js";
import type { RunId, RunnerId, RunnerProjectId } from "./ids.js";

/** 대기열에 있는 Queued 런 하나 */
export interface QueuedRun {
  id: RunId;
  /** 할당된 때. 대기열 순서이고, 러너를 비웠다 다시 정해도 바뀌지 않는다(Q73). */
  assignedAt: Date;
  project: RunnerProjectId;
  /** 할당 때 정한 러너. 맞는 러너가 모두 Offline이었거나 비웠으면 null이다. */
  runnerId: RunnerId | null;
}

export interface RunnerChoice {
  runId: RunId;
  runnerId: RunnerId;
}

export interface QueuePlan {
  /** 정한 러너가 Offline이 되어(또는 등록에서 사라져) 러너를 비울 런(Q72) */
  cleared: RunId[];
  /** 러너를 새로 정할 런(Q65·Q73). cleared에 있던 런이 같은 판단에서 다시 정해질 수 있다. */
  assigned: RunnerChoice[];
  /** 지금 시작할 런. 들어온 순서다. */
  start: RunnerChoice[];
}

/**
 * 설치 전체에 하나인 엄격한 FIFO 대기열에서 이번에 할 일을 정한다(ADR 0006, 스펙 3.3).
 *
 * ```
 * for run in queued (assignedAt 순서):
 *   if run.runner가 Offline이거나 없음: 러너를 비운다                    (Q72)
 *   if run에 러너가 없음:
 *     runner = pickRunner(run.project)                                    (Q53·Q65)
 *     if runner 없음: 순서에서 빠진다. 뒤 런을 막지 않는다               (Q68)
 *     else: 러너를 정하고 원래 자리(assignedAt)에서 이어 간다            (Q73)
 *   if 앞 런이 막혔음: 기다린다                                          (Q63 개정)
 *   elif run.runner에 남은 capacity가 있음: 시작한다
 *   else: 막힌다. 뒤 런은 러너와 상관없이 모두 기다린다                  (Q63 개정)
 * ```
 *
 * 이번에 시작하기로 한 런은 Running으로 보고 다음 런의 남은 capacity와 러너 고르기에 넣는다.
 * Disconnected 런은 capacity를 차지한다(Q74, `runs`에 넣어 준다).
 */
export function planQueue(input: {
  queued: ReadonlyArray<QueuedRun>;
  runners: ReadonlyArray<RunnerSnapshot>;
  /** capacity를 셀 런. Queued·Ended 런은 넣어도 세지 않는다. */
  runs: ReadonlyArray<RunPlacement>;
}): QueuePlan {
  const plan: QueuePlan = { cleared: [], assigned: [], start: [] };
  const runnersById = new Map(input.runners.map((runner) => [runner.id, runner]));
  const placements: RunPlacement[] = [...input.runs];
  let blocked = false;

  for (const run of fifoOrder(input.queued)) {
    let runnerId = run.runnerId;

    if (runnerId !== null && runnersById.get(runnerId)?.online !== true) {
      plan.cleared.push(run.id);
      runnerId = null;
    }

    if (runnerId === null) {
      runnerId = pickRunner({ project: run.project, runners: input.runners, runs: placements });
      if (runnerId === null) continue;
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

function fifoOrder(queued: ReadonlyArray<QueuedRun>): QueuedRun[] {
  // Array.prototype.toSorted는 안정 정렬이라 같은 시각이면 받은 순서를 지킨다.
  return queued.toSorted((a, b) => a.assignedAt.getTime() - b.assignedAt.getTime());
}
