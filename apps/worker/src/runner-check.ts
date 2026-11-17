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

/** 러너 상태를 다시 확인하는 간격. 마지막 확인 시각은 DB에 있어 재시작해도 간격이 이어진다. */
export const RUNNER_CHECK_INTERVAL_MS = 60_000;

/**
 * 러너 상태 확인(스펙 9절, Q82.14·Q82.15). 마지막 확인에서 간격이 지난 러너마다 Online/Offline, 확인 시각,
 * 러너 쪽 프로젝트 목록, 할당을 막는 필수 조건(1단계는 프로젝트별 GitHub 인증)을 DB에 쓴다. Runners 화면,
 * Settings Mapping, 러너 고르기가 읽는다. 할당을 막는 조건이 깨졌거나 프로젝트가 빠진 러너로 정한 Queued
 * 런은 같은 바퀴의 대기열 판단(core planQueue)이 러너를 비운다(Q78·Q82.22).
 *
 * 러너에 닿지 않아 프로젝트 목록이나 필수 조건을 읽지 못하면 이전 값을 남긴다.
 */
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

/**
 * 러너 하나를 확인하고 결과를 DB에 쓴다. 주기적 확인과 web의 러너 확인 요청(Q61)이 함께 쓴다. 닿았으면
 * 사람이 지워야 하는 워크트리가 러너에서 사라졌는지도 본다(Q75). 확인 결과나 확인하지 못한 오류를 돌려준다.
 */
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
    // 닿지 않았으면 필수 조건을 확인하지 못했으니 이전 값을 남긴다.
    assignmentBlocked: health.online ? isAssignmentBlocked(health) : null,
  });
  if (health.online) await confirmRemovedWorktrees(context, stored, runner);
  return { ok: true, health };
}

/**
 * 자동으로 지우지 않는 워크트리(요약 계산 함수의 워크트리 처리가 사람이 정함: 러너 연결 끊김, 러너에 닿지
 * 못한 채 끝난 운영자가 취소함)를 사람이 러너에서 지웠는지 본다. 사라졌으면 지운 시각을 기록한다(Q75).
 * worker는 이 워크트리를 지우지 않는다.
 */
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
