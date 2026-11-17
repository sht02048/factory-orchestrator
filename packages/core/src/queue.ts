import { canRunnerTake, pickRunner, remainingCapacity } from "./assignment.js";
import type { RunnerSnapshot, RunPlacement } from "./assignment.js";
import type { RunId, RunnerId, RunnerProjectId } from "./ids.js";

/** 대기열에 있는 Queued 런 하나 */
export interface QueuedRun {
  id: RunId;
  /** 할당된 때. 대기열 순서이고, 러너를 비웠다 다시 정해도 바뀌지 않는다(Q73). */
  assignedAt: Date;
  project: RunnerProjectId;
  /** 할당 때 정한 러너. 맞는 러너가 없었거나 비웠으면 null이다. */
  runnerId: RunnerId | null;
  /**
   * 영영 시작할 수 없는지(예: 그 런의 Mapping이 삭제됨, Q82.16). 대기열 맨 앞에 오면 시작할 수 없음으로
   * 끝내 뒤 런을 막지 않는다.
   */
  unstartable: boolean;
}

export interface RunnerChoice {
  runId: RunId;
  runnerId: RunnerId;
}

/**
 * 러너를 정하지 못해 대기열 순서에서 빠진 이유(Q68·Q78·Q82.13·Q87). 그 러너 쪽 프로젝트가 있는 러너를 보고 정한다.
 * - runner-offline: 그 프로젝트가 있는 러너가 모두 Offline이다("맞는 러너가 Offline이라 기다리는 중")
 * - assignment-blocked: 그 프로젝트가 있는 Online 러너가 모두 할당을 막는 조건이 깨졌다(1단계는 GitHub 인증,
 *   "러너의 GitHub 인증이 깨져 기다리는 중")
 * - project-missing: 그 프로젝트가 있는 러너가 없다("러너에서 프로젝트가 빠져 다시 고르는 중")
 */
export type UnplacedReason = "runner-offline" | "assignment-blocked" | "project-missing";

export interface QueuePlan {
  /**
   * 정한 러너가 그 런을 받을 수 없게 되어 러너를 비울 런과 그 이유(Q72·Q78·Q82.22). 러너가 등록에서
   * 사라졌으면 runner-offline이다. 같은 판단에서 다른 러너로 다시 정해질 수 있다(assigned).
   */
  cleared: Array<{ runId: RunId; reason: UnplacedReason }>;
  /** 러너를 새로 정할 런(Q65·Q73). */
  assigned: RunnerChoice[];
  /** 러너를 정하지 못해 이번에 순서에서 빠진 런과 그 이유. 맞는 러너가 생기면 원래 자리로 돌아간다(Q73). */
  unplaced: Array<{ runId: RunId; reason: UnplacedReason }>;
  /** 맨 앞에서 영영 시작할 수 없어 시작할 수 없음으로 끝낼 런(Q82.16) */
  couldNotStart: RunId[];
  /** 지금 시작할 런. 들어온 순서다. */
  start: RunnerChoice[];
}

/**
 * 설치 전체에 하나인 엄격한 FIFO 대기열에서 이번에 할 일을 정한다(ADR 0006, 스펙 3절 3번).
 *
 * ```
 * for run in queued (assignedAt 순서):
 *   if 앞 런이 막히지 않았고 run이 영영 시작할 수 없음: 시작할 수 없음으로 끝낸다     (Q82.16)
 *   if run.runner가 그 런을 받을 수 없음(Offline, 등록에서 사라짐, 프로젝트가 빠짐,
 *      인증이 깨짐): 러너를 비운다                                                    (Q72·Q78·Q82.22)
 *   if run에 러너가 없음:
 *     runner = pickRunner(run.project)                                                (Q53·Q65·Q82.14)
 *     if runner 없음: 이유와 함께 순서에서 빠진다. 뒤 런을 막지 않는다               (Q68·Q82.13·Q87)
 *     else: 러너를 정하고 원래 자리(assignedAt)에서 이어 간다                        (Q73)
 *   if 앞 런이 막혔음: 기다린다                                                      (Q63 개정)
 *   elif run.runner에 남은 capacity가 있음: 시작한다
 *   else: 막힌다. 뒤 런은 러너와 상관없이 모두 기다린다                              (Q63 개정)
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
      runnerId = pickRunner({ project: run.project, runners: input.runners, runs: placements });
      if (runnerId === null) {
        plan.unplaced.push({ runId: run.id, reason: unplacedReason(input.runners, run.project) });
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

/** 맞는 러너가 없을 때 그 이유. 그 프로젝트가 있는 러너 중 Online 러너가 있으면 인증이 깨진 것이다. */
function unplacedReason(
  runners: ReadonlyArray<RunnerSnapshot>,
  project: RunnerProjectId,
): UnplacedReason {
  const withProject = runners.filter((runner) => runner.projects.includes(project));
  if (withProject.length === 0) return "project-missing";
  return withProject.some((runner) => runner.online) ? "assignment-blocked" : "runner-offline";
}

function fifoOrder(queued: ReadonlyArray<QueuedRun>): QueuedRun[] {
  // Array.prototype.toSorted는 안정 정렬이라 같은 시각이면 받은 순서를 지킨다.
  return queued.toSorted((a, b) => a.assignedAt.getTime() - b.assignedAt.getTime());
}
