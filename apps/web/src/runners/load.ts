import { summarizeRunOutcome } from "@factory/core";
import { getRunWithRecords, listRunners, listRuns, listWorkspaces } from "@factory/db";
import type { Database, StoredRun } from "@factory/db";
import { z } from "zod";
import { prerequisiteProject } from "../labels";
import type {
  LeftWorktree,
  OccupyingRun,
  RunWorkspace,
  RunnerView,
  RunnersPage,
  QueuedRunView,
} from "./model";

/**
 * 러너 설정에서 화면에 보일 값. 설정은 어댑터마다 모양이 달라(ADR 0008) 있으면 보이고 없거나 모양이
 * 다르면 비운다. 이름은 research 0002 「어댑터 인터페이스 초안」의 Orca 러너 설정을 따른다.
 */
const runnerConfigSchema = z.object({
  sshTarget: z.string().min(1).optional().catch(undefined),
  orcaPath: z.string().min(1).optional().catch(undefined),
});

/**
 * Runners 화면이 보일 값을 DB 에서 읽는다. 러너는 Workspace 밖 자원이라 Workspace 를 받지 않고,
 * 모든 러너와 모든 Workspace 의 런을 담는다(ADR 0006).
 */
export function loadRunnersPage(db: Database, now: Date): RunnersPage {
  const workspaces = new Map(listWorkspaces(db).map((w) => [w.id, { id: w.id, name: w.name }]));
  const workspaceOf = (run: StoredRun): RunWorkspace =>
    workspaces.get(run.workspaceId) ?? { id: run.workspaceId, name: run.workspaceId };

  const occupying = new Map<string, OccupyingRun[]>();
  const queued = new Map<string, QueuedRunView[]>();
  const leftWorktrees = new Map<string, LeftWorktree[]>();
  const push = <T>(map: Map<string, T[]>, runnerId: string, item: T) => {
    const list = map.get(runnerId);
    if (list === undefined) map.set(runnerId, [item]);
    else list.push(item);
  };

  // listRuns 는 할당 순서다. Queued 는 대기열 순서와 같다.
  for (const run of listRuns(db)) {
    if (run.runnerId === null) continue;
    const base = { id: run.id, ticketKey: run.ticket.key, workspace: workspaceOf(run) };
    switch (run.state) {
      case "queued":
        push(queued, run.runnerId, { ...base, waitMs: now.getTime() - run.assignedAt.getTime() });
        break;
      // capacity 를 차지하는 상태(core CAPACITY_OCCUPYING_STATES). Disconnected 도 센다(Q74).
      case "running":
      case "waiting-for-input":
      case "disconnected":
        push(occupying, run.runnerId, {
          ...base,
          state: run.state,
          executionMs: now.getTime() - run.startedAt.getTime(),
        });
        break;
      case "ended": {
        // 워크트리를 남길지는 요약 계산 함수만 정한다(CODING_STANDARDS).
        const { worktree } = summarizeRunOutcome(run);
        if (worktree !== "keep-until-pr-settles" && worktree !== "operator-decides") break;
        if (getRunWithRecords(db, run.id)?.records.worktreeRemovedAt !== null) break;
        push(leftWorktrees, run.runnerId, { ...base, worktree });
        break;
      }
    }
  }

  const runners = listRunners(db).map((runner): RunnerView => {
    const parsed = runnerConfigSchema.safeParse(runner.config);
    const config = parsed.success ? parsed.data : {};
    return {
      id: runner.id,
      name: runner.name,
      online: runner.online,
      assignmentBlocked: runner.assignmentBlocked,
      githubAuth:
        runner.prerequisites === null
          ? null
          : runner.prerequisites
              .filter((p) => p.blocksAssignment)
              // 해결 방법은 어댑터 문구 대신 화면 메시지로 한 번 보인다.
              .map((p) => ({
                id: p.id,
                name: p.name,
                project: prerequisiteProject(p.id, runner.projects),
                satisfied: p.satisfied,
              })),
      checked:
        runner.checkedAt === null
          ? null
          : {
              at: runner.checkedAt.toISOString(),
              agoMs: now.getTime() - runner.checkedAt.getTime(),
            },
      capacity: runner.capacity,
      occupying: (occupying.get(runner.id) ?? []).toSorted((a, b) => b.executionMs - a.executionMs),
      queued: queued.get(runner.id) ?? [],
      leftWorktrees: leftWorktrees.get(runner.id) ?? [],
      projects: runner.projects.map((p) => p.displayName),
      sshTarget: config.sshTarget ?? null,
      orcaPath: config.orcaPath ?? null,
    };
  });
  return { runners };
}
