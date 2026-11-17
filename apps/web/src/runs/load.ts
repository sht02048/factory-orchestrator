import { runDurations, summarizeRunOutcome } from "@factory/core";
import type { QueuedRun, RunId } from "@factory/core";
import {
  getRunWithRecords,
  getWorkspaceTrackerProject,
  listRunPlacements,
  listRunnerSnapshots,
  listRuns,
  listRunners,
  listWorkspaces,
  toWorkspaceId,
} from "@factory/db";
import type { Database, StoredRun } from "@factory/db";
import { resolveWorkspace } from "../shell/model";
import type { QueuedReason, RunView, RunsPage } from "./model";
import { explainQueue } from "./queue-reasons";

/**
 * Runs 화면이 보일 값을 DB 에서 읽는다. 현재 Workspace(주소의 ws)의 런만 담고, 새 것부터 둔다.
 * 요약 결과는 저장하지 않으므로 core summarizeRunOutcome 으로 계산한다(Q66·Q76).
 */
export function loadRunsPage(db: Database, ws: string | undefined, now: Date): RunsPage {
  const workspace = resolveWorkspace(
    listWorkspaces(db).map((w) => ({ id: w.id, name: w.name })),
    ws,
  );
  if (workspace.kind !== "one") return { workspace, runs: [] };

  const runners = new Map(listRunners(db).map((r) => [r.id, r]));
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
            },
          ]
        : [],
    ),
    runners: listRunnerSnapshots(db),
    runs: listRunPlacements(db),
  });

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

  const queuedReason = (id: RunId): QueuedReason => {
    const code = queueReasons.get(id) ?? { kind: "behind" };
    if (code.kind !== "no-capacity") return code;
    return { kind: "no-capacity", runner: runners.get(code.runnerId)?.name ?? code.runnerId };
  };

  const runs = listRuns(db, { workspaceId: toWorkspaceId(workspace.workspace.id) })
    .toReversed()
    .map((run): RunView => {
      const records = getRunWithRecords(db, run.id)?.records;
      const runner = run.runnerId === null ? undefined : runners.get(run.runnerId);
      const startedAt = run.state === "queued" ? null : run.startedAt;
      const durations = runDurations({
        assignedAt: run.assignedAt,
        startedAt,
        endedAt: run.state === "ended" ? run.endedAt : null,
        now,
      });
      const pr = records?.pullRequest;
      const base = {
        id: run.id,
        ticketKey: run.ticket.key,
        trackerProject: projectName(run),
        branch: run.branch,
        runner: runner === undefined ? null : { name: runner.name, online: runner.online },
        agent: run.agent,
        waitMs: durations.waitMs ?? 0,
        executionMs: durations.executionMs,
        pullRequest:
          pr === null || pr === undefined || !isWebUrl(pr.url)
            ? null
            : { displayId: pr.displayId, url: pr.url },
      };
      switch (run.state) {
        case "queued":
          return { ...base, state: run.state, queuedReason: queuedReason(run.id) };
        case "running":
        case "waiting-for-input":
        case "disconnected":
          return { ...base, state: run.state };
        case "ended":
          return {
            ...base,
            state: run.state,
            agentResult: run.agentResult,
            prState: run.prState,
            summary: summarizeRunOutcome(run.agentResult, run.prState).outcome,
          };
      }
    });

  return { workspace, runs };
}

/** 화면에 링크로 거는 PR 주소. 코드 호스트가 준 값이라 http(s) 주소만 건다(javascript: 등을 막는다). */
function isWebUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const { protocol } = new URL(value);
  return protocol === "https:" || protocol === "http:";
}
