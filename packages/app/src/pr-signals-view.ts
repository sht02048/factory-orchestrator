import { summarizeRunOutcome } from "@ganger/core";
import type { RunRecords, StoredRun } from "@ganger/db";

export interface PrSignalsView {
  ciFailed: boolean;
  checkTotal: number | null;
  failedCount: number;
  failedChecks: string[];
  checksTruncated: boolean;
  conflict: boolean | null;
  behindBy: number | null;
  checkedAt: string;
}

function isStillReread(run: StoredRun, records: RunRecords): boolean {
  if (run.state !== "ended") return true;
  return (
    run.prState === "open" &&
    records.laterPrState === null &&
    records.worktreeRemovedAt === null &&
    records.worktreeKept === null &&
    records.worktreeRemoveRequestedAt === null &&
    summarizeRunOutcome(run).worktree === "keep-until-pr-settles"
  );
}

export function prSignalsViewOf(run: StoredRun, records: RunRecords): PrSignalsView | null {
  const pr = records.pullRequest;
  if (pr === null || !isStillReread(run, records)) return null;
  const signals = pr.signals ?? null;
  const readWithCi = pr.signalsReadAt?.getTime() === pr.checkedAt.getTime();
  const checks = readWithCi && signals?.checkTotal != null ? signals : null;
  const ciFailed = checks === null ? pr.ci === "failure" : checks.ciFailed;
  if (signals === null) {
    if (!ciFailed) return null;
  } else if (!signals.open) {
    return null;
  }
  return {
    ciFailed,
    checkTotal: checks?.checkTotal ?? null,
    failedCount: checks?.failedCount ?? 0,
    failedChecks: [...(checks?.failedChecks ?? [])],
    checksTruncated: checks?.checksTruncated ?? false,
    conflict: signals?.conflict ?? null,
    behindBy: signals?.behindBy ?? null,
    checkedAt: (pr.signalsReadAt ?? pr.checkedAt).toISOString(),
  };
}
