import { planQueue } from "@ganger/core";
import type {
  QueuedRun,
  RunId,
  RunPlacement,
  RunnerId,
  RunnerSnapshot,
  UnplacedReason,
} from "@ganger/core";
import type { QueuedReason } from "./model.js";

export type QueuedReasonCode =
  | { kind: "starting" | "behind" | UnplacedReason }
  | { kind: "no-capacity"; runnerId: RunnerId }
  | { kind: "usage-limit"; provider: string; until: Date };

export function describeQueuedReason(
  code: QueuedReasonCode,
  runnerName: (id: RunnerId) => string,
  now: Date,
): QueuedReason {
  switch (code.kind) {
    case "no-capacity":
      return { kind: "no-capacity", runner: runnerName(code.runnerId) };
    case "usage-limit":
      return {
        kind: "usage-limit",
        provider: code.provider,
        resetsInMs: Math.max(0, code.until.getTime() - now.getTime()),
      };
    case "starting":
    case "behind":
    case "runner-offline":
    case "project-missing":
    case "assignment-blocked":
      return code;
  }
}

export function explainQueue(input: {
  queued: ReadonlyArray<QueuedRun>;
  runners: ReadonlyArray<RunnerSnapshot>;
  runs: ReadonlyArray<RunPlacement>;
}): Map<RunId, QueuedReasonCode> {
  const plan = planQueue(input);
  const starting = new Set(plan.start.map((s) => s.runId));
  const unplaced = new Map(plan.unplaced.map((u) => [u.runId, u]));
  const assigned = new Map(plan.assigned.map((a) => [a.runId, a.runnerId]));

  const reasons = new Map<RunId, QueuedReasonCode>();
  const waitedOn = new Set<RunnerId>();
  const ordered = input.queued.toSorted((a, b) => a.assignedAt.getTime() - b.assignedAt.getTime());
  for (const run of ordered) {
    if (starting.has(run.id)) {
      reasons.set(run.id, { kind: "starting" });
      continue;
    }
    const reason = unplaced.get(run.id);
    if (reason !== undefined) {
      reasons.set(
        run.id,
        reason.reason === "usage-limit"
          ? { kind: "usage-limit", provider: reason.limit.provider, until: reason.limit.until }
          : { kind: reason.reason },
      );
      continue;
    }
    const runnerId = assigned.get(run.id) ?? run.runnerId;
    if (runnerId === null || waitedOn.has(runnerId)) {
      reasons.set(run.id, { kind: "behind" });
    } else {
      waitedOn.add(runnerId);
      reasons.set(run.id, { kind: "no-capacity", runnerId });
    }
  }
  return reasons;
}
