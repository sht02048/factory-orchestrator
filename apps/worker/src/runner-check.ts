import { isAssignmentBlocked, summarizeRunOutcome } from "@factory/core";
import type { Runner, RunnerErrorDetail, RunnerHealth, RunnerProject } from "@factory/core";
import {
  getRunWithRecords,
  listRuns,
  recordRunnerCheck,
  listRunners,
  updateRunRecords,
} from "@factory/db";
import type { StoredRunner } from "@factory/db";
import { describe, runnerErrorDetail, tryWrite } from "./context.js";
import type { TickContext } from "./context.js";

export const RUNNER_CHECK_INTERVAL_MS = 60_000;

export async function checkRunners(context: TickContext): Promise<void> {
  const now = context.now().getTime();
  for (const stored of listRunners(context.db)) {
    if (stored.checkedAt !== null && now - stored.checkedAt.getTime() < RUNNER_CHECK_INTERVAL_MS) {
      continue;
    }
    try {
      await checkRunner(context, stored);
    } catch (error) {
      context.logger.warn("could not record runner check", { runnerId: stored.id, error });
    }
  }
}

export async function checkRunner(
  context: TickContext,
  stored: StoredRunner,
): Promise<{ ok: true; health: RunnerHealth } | { ok: false; error: RunnerErrorDetail }> {
  const runner = context.adapters.runner(stored);
  let health: RunnerHealth;
  try {
    health = await runner.checkHealth();
  } catch (error) {
    context.logger.warn("could not check runner", { runnerId: stored.id, error });
    recordRunnerCheck(context.db, {
      runnerId: stored.id,
      online: false,
      checkedAt: context.now(),
      error: checkError(error),
      projects: null,
      assignmentBlocked: null,
    });
    return { ok: false, error: checkError(error) };
  }

  let projects: ReadonlyArray<RunnerProject> | null = null;
  if (health.online) {
    try {
      projects = await runner.listProjects();
    } catch (error) {
      context.logger.warn("could not list runner projects", { runnerId: stored.id, error });
    }
  }
  recordRunnerCheck(context.db, {
    runnerId: stored.id,
    online: health.online,
    checkedAt: context.now(),
    error: health.error,
    projects,
    assignmentBlocked: health.online ? isAssignmentBlocked(health) : null,
    prerequisites: health.online ? health.prerequisites : null,
  });
  if (health.online) {
    try {
      await confirmRemovedWorktrees(context, stored, runner);
    } catch (error) {
      context.logger.warn("could not confirm removed worktrees", { runnerId: stored.id, error });
    }
  }
  return { ok: true, health };
}

async function confirmRemovedWorktrees(
  context: TickContext,
  stored: StoredRunner,
  runner: Runner,
): Promise<void> {
  for (const run of listRuns(context.db, { states: ["ended"] })) {
    if (run.state !== "ended" || run.worktree === null || run.runnerId !== stored.id) continue;
    if (summarizeRunOutcome(run).worktree !== "operator-decides") continue;
    if (getRunWithRecords(context.db, run.id)?.records.worktreeRemovedAt !== null) continue;
    let exists: boolean;
    try {
      exists = await runner.worktreeExists(run.worktree);
    } catch (error) {
      context.logger.warn("could not check whether a kept worktree still exists", {
        runId: run.id,
        error,
      });
      continue;
    }
    if (exists) continue;
    tryWrite(context, run.id, () =>
      updateRunRecords(context.db, run.id, { worktreeRemovedAt: context.now() }),
    );
  }
}

function checkError(error: unknown): RunnerErrorDetail {
  return (
    runnerErrorDetail(error) ?? {
      kind: "malformed-output",
      raw: error instanceof Error ? error.message : describe({ error: String(error) }),
    }
  );
}
