import { planQueue } from "@ganger/core";
import type {
  QueuedRun,
  RunId,
  RunPlacement,
  RunnerId,
  RunnerSnapshot,
  UnplacedReason,
} from "@ganger/core";

export type QueuedReasonCode =
  | { kind: "starting" | "behind" | UnplacedReason }
  | { kind: "no-capacity"; runnerId: RunnerId };

export function explainQueue(input: {
  queued: ReadonlyArray<QueuedRun>;
  runners: ReadonlyArray<RunnerSnapshot>;
  runs: ReadonlyArray<RunPlacement>;
}): Map<RunId, QueuedReasonCode> {
  const plan = planQueue(input);
  const starting = new Set(plan.start.map((s) => s.runId));
  const unplaced = new Map(plan.unplaced.map((u) => [u.runId, u.reason]));
  const assigned = new Map(plan.assigned.map((a) => [a.runId, a.runnerId]));

  const reasons = new Map<RunId, QueuedReasonCode>();
  let blocked = false;
  const ordered = input.queued.toSorted((a, b) => a.assignedAt.getTime() - b.assignedAt.getTime());
  for (const run of ordered) {
    if (starting.has(run.id)) {
      reasons.set(run.id, { kind: "starting" });
      continue;
    }
    const reason = unplaced.get(run.id);
    if (reason !== undefined) {
      reasons.set(run.id, { kind: reason });
      continue;
    }
    const runnerId = assigned.get(run.id) ?? run.runnerId;
    if (blocked || runnerId === null) {
      reasons.set(run.id, { kind: "behind" });
    } else {
      blocked = true;
      reasons.set(run.id, { kind: "no-capacity", runnerId });
    }
  }
  return reasons;
}
