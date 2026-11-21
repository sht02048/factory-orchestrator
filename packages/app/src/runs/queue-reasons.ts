import {
  decideBlockerWait,
  isBlockerFinished,
  planQueue,
  priorityRank,
  queueOrder,
} from "@ganger/core";
import type {
  BlockerStuckCause,
  BlockerWait,
  QueuedRun,
  RunId,
  RunPlacement,
  RunnerId,
  RunnerSnapshot,
  StoredBlocker,
  UnplacedReason,
} from "@ganger/core";
import {
  isPinnedToRunner,
  listQueuedBlockerStates,
  listRunPlacements,
  listRunnerSnapshots,
  listRunsWithRecords,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import type { BlockerView, QueuedReason } from "./model.js";

export type QueuedReasonCode =
  | { kind: "starting" | "behind" | UnplacedReason }
  | { kind: "no-capacity"; runnerId: RunnerId }
  | { kind: "usage-limit"; provider: string; until: Date }
  | { kind: "blockers-waiting"; blockers: BlockerView[]; finished?: BlockerView[] }
  | {
      kind: "blockers-stuck";
      cause: BlockerStuckCause;
      blocker: BlockerView | null;
      blockers: BlockerView[];
    };

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
    case "blockers-waiting":
    case "blockers-stuck":
      return code;
  }
}

function blockerView(blocker: StoredBlocker): BlockerView {
  return {
    key: blocker.key,
    title: blocker.title,
    stateName: blocker.stateName,
    stateCategory: blocker.stateCategory,
  };
}

function blockerReason(wait: BlockerWait): QueuedReasonCode | null {
  switch (wait.kind) {
    case "none":
    case "checking":
      return null;
    case "waiting":
      return { kind: "blockers-waiting", blockers: wait.blockers.map(blockerView) };
    case "stuck":
      return {
        kind: "blockers-stuck",
        cause: wait.cause,
        blocker: wait.blocker === null ? null : blockerView(wait.blocker),
        blockers: wait.blockers.map(blockerView),
      };
  }
}

export function explainQueue(input: {
  queued: ReadonlyArray<QueuedRun>;
  runners: ReadonlyArray<RunnerSnapshot>;
  runs: ReadonlyArray<RunPlacement>;
  waits?: ReadonlyMap<RunId, BlockerWait>;
}): Map<RunId, QueuedReasonCode> {
  const reasons = new Map<RunId, QueuedReasonCode>();
  const eligible = input.queued.filter((run) => {
    const wait = input.waits?.get(run.id);
    const reason = wait === undefined ? null : blockerReason(wait);
    if (reason === null) return true;
    reasons.set(run.id, reason);
    return false;
  });
  const plan = planQueue({ queued: eligible, runners: input.runners, runs: input.runs });
  const starting = new Set(plan.start.map((s) => s.runId));
  const unplaced = new Map(plan.unplaced.map((u) => [u.runId, u]));
  const assigned = new Map(plan.assigned.map((a) => [a.runId, a.runnerId]));

  const waitedOn = new Set<RunnerId>();
  for (const run of queueOrder(eligible)) {
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

export function loadQueueReasons(db: Database, now: Date): Map<RunId, QueuedReasonCode> {
  const states = listQueuedBlockerStates(db);
  const waits = new Map<RunId, BlockerWait>();
  for (const [runId, state] of states) waits.set(runId, decideBlockerWait(state));
  const reasons = explainQueue({
    queued: listRunsWithRecords(db, { states: ["queued"] }).flatMap(
      ({ run, records }): QueuedRun[] =>
        run.state === "queued"
          ? [
              {
                id: run.id,
                assignedAt: run.assignedAt,
                project: run.runnerProject,
                agent: run.agent,
                runnerId: run.runnerId,
                unstartable: false,
                pinnedToRunner: isPinnedToRunner(run),
                startRequested: records.startRequestedAt !== null,
                priorityRank: priorityRank(states.get(run.id)?.priority ?? "none"),
              },
            ]
          : [],
    ),
    runners: listRunnerSnapshots(db, now),
    runs: listRunPlacements(db),
    waits,
  });
  for (const [runId, reason] of reasons) {
    if (reason.kind !== "blockers-waiting") continue;
    const finished = (states.get(runId)?.blockers ?? [])
      .filter((blocker) => isBlockerFinished(blocker.stateCategory))
      .map(blockerView);
    if (finished.length > 0) reasons.set(runId, { ...reason, finished });
  }
  return reasons;
}
