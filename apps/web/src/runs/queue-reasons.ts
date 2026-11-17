import { planQueue } from "@factory/core";
import type { QueuedRun, RunId, RunPlacement, RunnerId, RunnerSnapshot } from "@factory/core";

export type QueuedReasonCode =
  | { kind: "starting" | "behind" | "runner-offline" }
  | { kind: "no-capacity"; runnerId: RunnerId };

/**
 * Queued 런마다 아직 시작하지 않은 이유를 정한다. 판단은 worker 와 같은 core planQueue 로 하고,
 * 여기서는 그 결과를 이유로 옮기기만 한다(엄격한 FIFO, Q63 개정·Q65·Q68·Q72).
 *
 * - planQueue 가 지금 시작하기로 한 런 → starting
 * - 러너를 정하지 못한 런(비웠고 다시 정하지 못함 포함) → runner-offline. 순서에서 빠진다
 * - 러너가 있는데 시작하지 못한 첫 런 → no-capacity. 이 런이 뒤 런을 막는다
 * - 그 뒤 러너가 있는 런 → behind
 *
 * 대기열은 설치 전체에 하나라 `queued`에는 모든 Workspace 의 Queued 런을 넣는다.
 */
export function explainQueue(input: {
  queued: ReadonlyArray<QueuedRun>;
  runners: ReadonlyArray<RunnerSnapshot>;
  runs: ReadonlyArray<RunPlacement>;
}): Map<RunId, QueuedReasonCode> {
  const plan = planQueue(input);
  const starting = new Set(plan.start.map((s) => s.runId));
  const cleared = new Set(plan.cleared);
  const assigned = new Map(plan.assigned.map((a) => [a.runId, a.runnerId]));

  const reasons = new Map<RunId, QueuedReasonCode>();
  let blocked = false;
  // planQueue 와 같은 순서(할당 시각, 같으면 받은 순서)로 본다.
  const ordered = input.queued.toSorted((a, b) => a.assignedAt.getTime() - b.assignedAt.getTime());
  for (const run of ordered) {
    if (starting.has(run.id)) {
      reasons.set(run.id, { kind: "starting" });
      continue;
    }
    const runnerId = assigned.get(run.id) ?? (cleared.has(run.id) ? null : run.runnerId);
    if (runnerId === null) {
      reasons.set(run.id, { kind: "runner-offline" });
    } else if (blocked) {
      reasons.set(run.id, { kind: "behind" });
    } else {
      blocked = true;
      reasons.set(run.id, { kind: "no-capacity", runnerId });
    }
  }
  return reasons;
}
