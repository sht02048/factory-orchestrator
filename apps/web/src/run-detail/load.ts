import { runDurations, summarizeRunOutcome, toRunId } from "@factory/core";
import type { CiState, QueuedRun, RunId } from "@factory/core";
import {
  getLogTailRequest,
  getRun,
  getRunWithRecords,
  getWorkspaceTrackerProject,
  getRunCancelRequest,
  listRunPlacements,
  listRunPermissionWaits,
  listRunQuestions,
  listRunStateChanges,
  listRunnerSnapshots,
  listRunners,
  listRuns,
  listWorkspaces,
  requestLogTail,
} from "@factory/db";
import type {
  Database,
  RunRecords,
  RunStateChangeRecord,
  StoredRun,
  StoredPermissionWait,
  StoredRunQuestion,
} from "@factory/db";
import { pendingInput } from "../home/load";
import type { QueuedReason } from "../runs/model";
import { explainQueue } from "../runs/queue-reasons";
import type {
  CiView,
  LogTailView,
  OtherRun,
  RunDetail,
  RunDetailPage,
  RunDetailStatus,
  TimelineEvent,
} from "./model";

/**
 * Run 상세가 보일 값을 DB 에서 읽는다. 읽기만 하고 쓰지 않는다. 로그 꼬리 요청은 requestRunLogTail 이 남긴다.
 * 요약 결과와 워크트리 처리는 저장하지 않으므로 core summarizeRunOutcome 으로 계산한다(Q66·Q76).
 */
export function loadRunDetail(db: Database, runId: string, now: Date): RunDetailPage {
  const found = getRunWithRecords(db, toRunId(runId));
  if (found === null) return { kind: "not-found" };
  const { run, records } = found;

  const runners = new Map(listRunners(db).map((r) => [r.id, r]));
  const runner = run.runnerId === null ? undefined : runners.get(run.runnerId);
  const workspace = listWorkspaces(db).find((w) => w.id === run.workspaceId);
  const startedAt = run.state === "queued" ? null : run.startedAt;
  const endedAt = run.state === "ended" ? run.endedAt : null;
  const durations = runDurations({ assignedAt: run.assignedAt, startedAt, endedAt, now });
  const pr = records.pullRequest;
  const questions = listRunQuestions(db, run.id);
  const permissionWaits = listRunPermissionWaits(db, run.id);
  const cancelRequest = getRunCancelRequest(db, run.id);

  const detail: RunDetail = {
    id: run.id,
    now: now.toISOString(),
    ticketKey: run.ticket.key,
    trackerProject:
      getWorkspaceTrackerProject(db, run.ticket.connection, run.trackerProject)?.name ??
      run.trackerProject,
    workspace: { id: run.workspaceId, name: workspace?.name ?? run.workspaceId },
    branch: run.state === "queued" ? null : run.branch,
    worktree: run.state === "queued" ? null : run.worktree,
    runner: runner === undefined ? null : { name: runner.name, online: runner.online },
    agent: run.agent,
    model: run.model,
    assignedAt: run.assignedAt.toISOString(),
    startedAt: startedAt?.toISOString() ?? null,
    endedAt: endedAt?.toISOString() ?? null,
    waitMs: durations.waitMs ?? 0,
    executionMs: durations.executionMs,
    status: statusOf(db, run, records),
    pullRequest:
      pr === null || !isWebUrl(pr.url)
        ? null
        : { displayId: pr.displayId, url: pr.url, ci: toCiView(pr.ci) },
    report: records.reportBody,
    startError:
      run.state === "ended" && run.agentResult === "could-not-start" ? records.startError : null,
    // 취소 중은 끝나지 않은 런의 표시다(Q82.21). 이미 끝났으면 worker 가 그 요청을 처리하지 않는다.
    cancelPending:
      run.state !== "ended" && cancelRequest !== null && cancelRequest.processedAt === null,
    timeline: timelineOf(
      run,
      records,
      listRunStateChanges(db, run.id),
      questions,
      permissionWaits,
      cancelRequest?.requestedAt ?? null,
    ),
    log: logOf(db, run, records),
    otherRuns: otherRunsOf(db, run),
  };
  return { kind: "found", run: detail };
}

/**
 * Run 상세를 열 때 로그 꼬리를 요청한다(Q46·Q61). worker 가 ssh 로 가져와 결과를 DB 에 쓴다.
 * 러너에서 돌고 있는 런만 요청한다. Queued 런은 로그가 없고, Ended 런은 저장한 마지막 200줄을 보인다.
 * 요청을 남겼으면 true 다.
 */
export function requestRunLogTail(db: Database, runId: string, now: Date): boolean {
  const run = getRun(db, toRunId(runId));
  if (run === null || run.state === "queued" || run.state === "ended") return false;
  requestLogTail(db, run.id, now);
  return true;
}

function statusOf(db: Database, run: StoredRun, records: RunRecords): RunDetailStatus {
  switch (run.state) {
    case "queued":
      return { state: "queued", queuedReason: queuedReasonOf(db, run.id) };
    case "running":
      return { state: "running" };
    case "waiting-for-input":
      return {
        state: "waiting-for-input",
        input: pendingInput(db, run.id) ?? { kind: "unknown" },
      };
    case "disconnected":
      return {
        state: "disconnected",
        unreachableSince: records.unreachableSince?.toISOString() ?? null,
      };
    case "ended": {
      const outcome = summarizeRunOutcome(run);
      return {
        state: "ended",
        agentResult: run.agentResult,
        prState: run.prState,
        summary: outcome.outcome,
        worktreeNeedsManualRemoval:
          outcome.worktree === "operator-decides" && records.worktreeRemovedAt === null,
        laterPrState:
          records.laterPrState === null
            ? null
            : { state: records.laterPrState.state, at: records.laterPrState.at.toISOString() },
      };
    }
  }
}

/** Queued 이유는 Runs 화면과 같은 판단(core planQueue)으로 정한다. 대기열은 설치 전체에 하나다(ADR 0006). */
function queuedReasonOf(db: Database, runId: RunId): QueuedReason {
  const reasons = explainQueue({
    queued: listRuns(db, { states: ["queued"] }).flatMap((run): QueuedRun[] =>
      run.state === "queued"
        ? [
            {
              id: run.id,
              assignedAt: run.assignedAt,
              project: run.runnerProject,
              runnerId: run.runnerId,
              // 영영 시작할 수 없는 런은 worker 가 다음 바퀴에 끝낸다. 화면은 순서만 본다(Runs 와 같다).
              unstartable: false,
            },
          ]
        : [],
    ),
    runners: listRunnerSnapshots(db),
    runs: listRunPlacements(db),
  });
  const code = reasons.get(runId) ?? { kind: "behind" };
  if (code.kind !== "no-capacity") return code;
  const runner = listRunners(db).find((r) => r.id === code.runnerId);
  return { kind: "no-capacity", runner: runner?.name ?? code.runnerId };
}

/**
 * 상태 변경 이력과 기록에서 타임라인을 만든다(Q67). 오래된 것부터 둔다.
 * 같은 시각이면 이력 순서를 지키고, ssh 가 실패하기 시작한 시각은 그 시각 자리에 끼운다.
 */
function timelineOf(
  run: StoredRun,
  records: RunRecords,
  changes: ReadonlyArray<RunStateChangeRecord>,
  questions: ReadonlyArray<StoredRunQuestion>,
  permissionWaits: ReadonlyArray<StoredPermissionWait>,
  cancelRequestedAt: Date | null,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const change of changes) {
    const event = changeEvent(run, change);
    if (event !== null) events.push(event);
  }
  for (const question of questions) {
    events.push({ kind: "question", body: question.body, at: question.askedAt.toISOString() });
    if (question.answer !== null) {
      events.push({
        kind: "answer",
        body: question.answer.text,
        at: question.answer.answeredAt.toISOString(),
      });
    }
  }
  for (const wait of permissionWaits) {
    events.push({ kind: "permission", body: wait.detail, at: wait.requestedAt.toISOString() });
    if (wait.denial !== null) {
      events.push({
        kind: "denied",
        body: wait.denial.reason,
        at: wait.denial.deniedAt.toISOString(),
      });
    }
  }
  if (cancelRequestedAt !== null) {
    events.push({ kind: "cancel-requested", at: cancelRequestedAt.toISOString() });
  }
  if (records.unreachableSince !== null) {
    events.push({ kind: "unreachable", at: records.unreachableSince.toISOString() });
  }
  if (records.laterPrState !== null) {
    events.push({
      kind: "later-pr",
      state: records.laterPrState.state,
      at: records.laterPrState.at.toISOString(),
    });
  }
  // toSorted 는 안정 정렬이라 같은 시각이면 넣은 순서를 지킨다.
  return events.toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

function changeEvent(run: StoredRun, change: RunStateChangeRecord): TimelineEvent | null {
  const at = change.at.toISOString();
  if (change.from === null) return { kind: "assigned", at };
  switch (change.to) {
    case "queued":
      return null;
    case "running":
      if (change.from === "disconnected") return { kind: "reconnected", at };
      if (change.from === "waiting-for-input") return { kind: "resumed", at };
      return { kind: "started", at };
    case "waiting-for-input":
      return change.from === "disconnected"
        ? { kind: "reconnected", at }
        : { kind: "waiting-for-input", at };
    case "disconnected":
      return { kind: "disconnected", at };
    case "ended":
      return run.state === "ended" ? { kind: "ended", agentResult: run.agentResult, at } : null;
  }
}

function logOf(db: Database, run: StoredRun, records: RunRecords): LogTailView {
  if (run.state === "queued") return { kind: "none" };
  if (run.state === "ended") return { kind: "stored", lines: records.lastLog ?? [] };
  const request = getLogTailRequest(db, run.id);
  if (request === null) return { kind: "pending" };
  switch (request.status) {
    case "pending":
      return { kind: "pending" };
    case "done":
      return { kind: "done", lines: request.result, at: request.completedAt.toISOString() };
    case "failed":
      return { kind: "failed", error: request.error, at: request.completedAt.toISOString() };
  }
}

function otherRunsOf(db: Database, run: StoredRun): OtherRun[] {
  return listRuns(db, { ticket: run.ticket })
    .filter((other) => other.id !== run.id)
    .toReversed()
    .map((other) => ({
      id: other.id,
      assignedAt: other.assignedAt.toISOString(),
      state: other.state,
      summary: other.state === "ended" ? summarizeRunOutcome(other).outcome : null,
    }));
}

/** 코드 호스트가 준 CI 값을 화면 값으로 옮긴다. 모르는 값은 unknown 이다(Q79). */
export function toCiView(ci: CiState): CiView {
  const known: ReadonlyArray<CiView> = ["success", "failure", "pending", "none", "unavailable"];
  return known.find((value) => value === ci) ?? "unknown";
}

/** 화면에 링크로 거는 PR 주소. 코드 호스트가 준 값이라 http(s) 주소만 건다(javascript: 등을 막는다). */
function isWebUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const { protocol } = new URL(value);
  return protocol === "https:" || protocol === "http:";
}
