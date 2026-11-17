import { runDurations, summarizeRunOutcome } from "@factory/core";
import type { QueuedRun, RunId } from "@factory/core";
import {
  getRunWithRecords,
  listPendingCancelRequests,
  listRunQuestions,
  getWorkspaceTrackerProject,
  listRunPlacements,
  listRunnerSnapshots,
  listRunners,
  listRuns,
  listWorkspaces,
  toWorkspaceId,
} from "@factory/db";
import type { Database, StoredRun } from "@factory/db";
import { explainQueue } from "../runs/queue-reasons";
import { isWebUrl } from "../format/url";
import { resolveWorkspace } from "../shell/model";
import type { QueuedReason } from "../runs/model";
import type { HomePage, HomeRun, InputWait } from "./model";
import { partitionHome } from "./model";

/**
 * 홈 화면이 보일 값을 DB 에서 읽는다(현재 Workspace, "전체"면 모든 Workspace).
 * 요약 결과는 저장하지 않으므로 core summarizeRunOutcome 으로 계산한다(Q66·Q76).
 */
export function loadHomePage(db: Database, ws: string | undefined, now: Date): HomePage {
  const workspaces = listWorkspaces(db).map((w) => ({ id: w.id, name: w.name }));
  const workspace = resolveWorkspace(workspaces, ws);
  if (workspace.kind === "none")
    return partitionHome({ workspace, runs: [], brokenAuthRunners: [] });

  const workspaceNames = new Map(workspaces.map((w) => [w.id, w]));
  const runners = new Map(listRunners(db).map((r) => [r.id, r]));
  const runs = listRuns(
    db,
    workspace.kind === "one" ? { workspaceId: toWorkspaceId(workspace.workspace.id) } : {},
  );

  const queueReasons = explainQueue({
    // 대기열은 설치 전체에 하나다. 다른 Workspace 의 Queued 런도 순서에 든다(ADR 0006).
    queued: listRuns(db, { states: ["queued"] }).flatMap((run): QueuedRun[] =>
      run.state === "queued"
        ? [
            {
              id: run.id,
              assignedAt: run.assignedAt,
              project: run.runnerProject,
              runnerId: run.runnerId,
              // 영영 시작할 수 없는 런은 worker 가 다음 바퀴에 끝낸다. 화면은 순서만 본다.
              unstartable: false,
            },
          ]
        : [],
    ),
    runners: listRunnerSnapshots(db),
    runs: listRunPlacements(db),
  });
  const cancelling = new Set<string>(listPendingCancelRequests(db).map((r) => r.runId));

  const queuedReason = (id: RunId): QueuedReason => {
    const code = queueReasons.get(id) ?? { kind: "behind" };
    if (code.kind !== "no-capacity") return code;
    return { kind: "no-capacity", runner: runners.get(code.runnerId)?.name ?? code.runnerId };
  };

  const projectNames = new Map<string, string>();
  const projectName = (run: StoredRun): string => {
    const key = `${run.ticket.connection}\u0000${run.trackerProject}`;
    let name = projectNames.get(key);
    if (name === undefined) {
      name =
        getWorkspaceTrackerProject(db, run.ticket.connection, run.trackerProject)?.name ??
        run.trackerProject;
      projectNames.set(key, name);
    }
    return name;
  };

  const toView = (run: StoredRun): HomeRun => {
    const records = getRunWithRecords(db, run.id)?.records;
    const runner = run.runnerId === null ? undefined : runners.get(run.runnerId);
    const durations = runDurations({
      assignedAt: run.assignedAt,
      startedAt: run.state === "queued" ? null : run.startedAt,
      endedAt: run.state === "ended" ? run.endedAt : null,
      now,
    });
    const pr = records?.pullRequest;
    const base = {
      id: run.id,
      ticketKey: run.ticket.key,
      trackerProject: projectName(run),
      workspace: workspaceNames.get(run.workspaceId) ?? {
        id: run.workspaceId,
        name: run.workspaceId,
      },
      runner: runner === undefined ? null : { name: runner.name, online: runner.online },
      agent: run.agent,
      waitMs: durations.waitMs ?? 0,
      executionMs: durations.executionMs,
      pullRequest:
        pr === null || pr === undefined || !isWebUrl(pr.url)
          ? null
          : { displayId: pr.displayId, url: pr.url },
      cancelling: cancelling.has(run.id),
    };
    switch (run.state) {
      case "queued":
        return { ...base, state: run.state, queuedReason: queuedReason(run.id) };
      case "running":
        return { ...base, state: run.state };
      case "waiting-for-input":
        return { ...base, state: run.state, input: pendingQuestion(db, run.id) };
      case "disconnected": {
        const since = records?.unreachableSince ?? null;
        return {
          ...base,
          state: run.state,
          unreachableMs: since === null ? null : Math.max(0, now.getTime() - since.getTime()),
        };
      }
      case "ended":
        return {
          ...base,
          state: run.state,
          agentResult: run.agentResult,
          prState: run.prState,
          summary: summarizeRunOutcome(run).outcome,
          prSettledLater: (records?.laterPrState ?? null) !== null,
        };
    }
  };

  return partitionHome({
    workspace,
    runs: runs.map((run) => ({
      ticket: `${run.ticket.connection}\u0000${run.ticket.key}`,
      run: toView(run),
    })),
    // 러너는 Workspace 밖 자원이라 어느 Workspace 의 홈에서든 보인다(ADR 0006)
    brokenAuthRunners: [...runners.values()]
      .filter((runner) => runner.assignmentBlocked)
      .map((runner) => ({ id: runner.id, name: runner.name })),
  });
}

/**
 * 입력 기다림 런이 기다리는 질문. 아직 러너에 보내지 않은 질문 가운데 먼저 받은 것이다(Q82.3·Q82.5).
 * 답을 남겼지만 worker 가 아직 보내지 않았으면 answered 다. worker 가 질문을 아직 쓰지 않았으면 null 이다.
 */
function pendingQuestion(db: Database, runId: RunId): InputWait | null {
  const question = listRunQuestions(db, runId).find(
    (q) => q.answer === null || q.answer.sentAt === null,
  );
  if (question === undefined) return null;
  return {
    kind: "question",
    questionId: question.id,
    body: question.body,
    choices: question.options,
    answered: question.answer !== null,
  };
}
