import { runDurations, summarizeRunOutcome } from "@factory/core";
import type { QueuedRun, RunId } from "@factory/core";
import {
  getRunWithRecords,
  listPendingCancelRequests,
  listRunPermissionWaits,
  listRunQuestions,
  listRunStateChanges,
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
import { resolveWorkspace, runnerIssueCause } from "../shell/model";
import { DAY_MS, calendarDay } from "../time-zone";
import type { QueuedReason } from "../runs/model";
import type { Activity, ActivityEvent, HomePage, HomeRun, InputWait, RunnerIssue } from "./model";
import { partitionHome } from "./model";

/** 흐름에 보이는 사건 수 */
const ACTIVITY_LIMIT = 8;

/**
 * 홈 화면이 보일 값을 DB 에서 읽는다(현재 Workspace, "전체"면 모든 Workspace).
 * 요약 결과는 저장하지 않으므로 core summarizeRunOutcome 으로 계산한다(Q66·Q76).
 * "오늘"은 운영자 시간대(timeZone, 0044)로 자른다.
 */
export function loadHomePage(
  db: Database,
  ws: string | undefined,
  now: Date,
  timeZone: string,
): HomePage {
  const workspaces = listWorkspaces(db).map((w) => ({ id: w.id, name: w.name }));
  const workspace = resolveWorkspace(workspaces, ws);
  if (workspace.kind === "none")
    return partitionHome({ workspace, runs: [], runnerIssues: [], mergedToday: 0, activity: [] });

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
        return { ...base, state: run.state, input: pendingInput(db, run.id) };
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

  const today = calendarDay(now, timeZone);
  return partitionHome({
    workspace,
    runs: runs.map((run) => ({
      ticket: `${run.ticket.connection}\u0000${run.ticket.key}`,
      run: toView(run),
    })),
    // 러너는 Workspace 밖 자원이라 어느 Workspace 의 홈에서든 보인다(ADR 0006)
    runnerIssues: [...runners.values()].flatMap((runner): RunnerIssue[] => {
      const cause = runnerIssueCause(runner);
      return cause === null ? [] : [{ id: runner.id, name: runner.name, cause }];
    }),
    mergedToday: runs.filter(
      (run) =>
        run.state === "ended" &&
        calendarDay(run.endedAt, timeZone) === today &&
        summarizeRunOutcome(run).outcome === "merged",
    ).length,
    activity: activityOf(db, runs, workspaceNames, now),
  });
}

/**
 * 지금 일어나는 일(ADR 0010 Consequences). DB 에 있는 기록(상태 바뀜, 질문, 권한 대기, 런 끝, 이후 PR)만으로
 * 만들고 새 것부터 ACTIVITY_LIMIT 개를 둔다. 하루가 넘게 전에 끝난 런은 이후 PR 상태만 본다.
 * 입력 기다림 상태 바뀜은 같은 때의 질문·권한 대기 사건이 대신한다.
 */
function activityOf(
  db: Database,
  runs: ReadonlyArray<StoredRun>,
  workspaces: ReadonlyMap<string, { id: string; name: string }>,
  now: Date,
): Activity[] {
  const since = now.getTime() - DAY_MS;
  const items: Activity[] = [];
  for (const run of runs) {
    const base = {
      runId: run.id,
      ticketKey: run.ticket.key,
      workspace: workspaces.get(run.workspaceId) ?? { id: run.workspaceId, name: run.workspaceId },
    };
    const push = (event: ActivityEvent, at: Date, key: string) => {
      // 하루가 넘은 일과 읽은 때보다 뒤의 일은 뺀다
      if (at.getTime() < since || at.getTime() > now.getTime()) return;
      items.push({
        ...base,
        key: `${run.id}:${key}`,
        event,
        at: at.toISOString(),
        agoMs: Math.max(0, now.getTime() - at.getTime()),
      });
    };
    const laterPr = getRunWithRecords(db, run.id)?.records.laterPrState ?? null;
    if (laterPr !== null) push({ kind: "later-pr", state: laterPr.state }, laterPr.at, "later-pr");
    if (run.state === "ended" && run.endedAt.getTime() < since) continue;

    for (const [index, change] of listRunStateChanges(db, run.id).entries()) {
      const key = `change:${index}`;
      if (change.from === "queued" && change.to === "running")
        push({ kind: "started" }, change.at, key);
      else if (change.to === "disconnected") push({ kind: "disconnected" }, change.at, key);
      else if (change.to === "ended" && run.state === "ended")
        push({ kind: "ended", summary: summarizeRunOutcome(run).outcome }, change.at, key);
    }
    for (const question of listRunQuestions(db, run.id))
      push({ kind: "question" }, question.askedAt, `question:${question.id}`);
    for (const wait of listRunPermissionWaits(db, run.id))
      push({ kind: "permission" }, wait.requestedAt, `permission:${wait.id}`);
  }
  // 같은 시각이면 넣은 순서의 반대(나중 사건이 위)
  return items
    .map((item, index) => ({ item, index }))
    .toSorted((a, b) => Date.parse(b.item.at) - Date.parse(a.item.at) || b.index - a.index)
    .slice(0, ACTIVITY_LIMIT)
    .map(({ item }) => item);
}

/**
 * 입력 기다림 런이 기다리는 입력(Q82.3·Q82.4·Q82.5). 아직 러너에 보내지 않은 질문과, 닫히지 않았고 거절을
 * 보내지 않은 권한 대기 가운데 먼저 받은 것이다. 답이나 거절을 남겼지만 worker 가 아직 보내지 않았으면
 * answered·denied 다. worker 가 아직 아무것도 쓰지 않았으면 null 이다.
 */
export function pendingInput(db: Database, runId: RunId): InputWait | null {
  const inputs: Array<{ at: Date; input: InputWait }> = [];
  for (const q of listRunQuestions(db, runId)) {
    if (q.answer !== null && q.answer.sentAt !== null) continue;
    inputs.push({
      at: q.askedAt,
      input: {
        kind: "question",
        questionId: q.id,
        body: q.body,
        choices: q.options,
        answered: q.answer !== null,
      },
    });
  }
  for (const wait of listRunPermissionWaits(db, runId)) {
    if (wait.resolvedAt !== null || (wait.denial !== null && wait.denial.sentAt !== null)) continue;
    inputs.push({
      at: wait.requestedAt,
      input: {
        kind: "permission",
        promptId: wait.id,
        detail: wait.detail,
        denied: wait.denial !== null,
      },
    });
  }
  return inputs.toSorted((a, b) => a.at.getTime() - b.at.getTime())[0]?.input ?? null;
}
