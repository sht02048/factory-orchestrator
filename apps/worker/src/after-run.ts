import { AdapterError, summarizeRunOutcome } from "@factory/core";
import type { PullRequestSnapshot, Tracker } from "@factory/core";
import {
  getRunWithRecords,
  getWorkspaceTrackerProject,
  listRunners,
  listRuns,
  updateRunRecords,
} from "@factory/db";
import type { RunRecords, StoredRun, StoredRunner } from "@factory/db";
import { decideRunPrState, tryWrite } from "./context.js";
import type { ActiveRun, StartedStoredRun, TickContext } from "./context.js";
import { messages } from "./messages.js";

/** 런과 이어진 PR의 상태와 CI 상태를 다시 조회하는 간격. 코드 호스트 요청 예산을 아낀다. */
export const PR_POLL_INTERVAL_MS = 60_000;

type EndedRun = Extract<StoredRun, { state: "ended" }>;
type StartedEndedRun = Extract<EndedRun, { startedAt: Date }>;

/**
 * 런 시작·종료 뒤처리(스펙 3절 7~9번). 감시(watch.ts)와 대기열이 런 상태와 두 축을 쓴 뒤에 돈다.
 *
 * - 시작한 런: 트래커 티켓을 Workspace의 "In Progress" 상태로 한 번 바꾸고(Q41·Q68), 이어진 PR과 CI 상태를
 *   폴링해 쓴다(Run 상세, 0022).
 * - 끝난 런: 결과 댓글을 한 번 달고(Q41), 요약 계산 함수의 워크트리 처리를 따른다(Q44·Q51). PR이 병합되거나
 *   닫힐 때까지 남긴 런은 PR을 폴링해 이후 PR 상태를 기록한 뒤 지운다(Q54·Q69). 두 축은 바꾸지 않는다.
 *
 * 트래커 갱신은 DB의 갱신 기록을 보고 한 번만 한다(ADR 0002·0005). 런 하나의 실패는 다음 바퀴에 다시 한다.
 */
export async function processAfterRuns(context: TickContext): Promise<void> {
  const runnersById = new Map(listRunners(context.db).map((runner) => [runner.id, runner]));
  const runs = listRuns(context.db, {
    states: ["running", "waiting-for-input", "disconnected", "ended"],
  });
  for (const run of runs) {
    try {
      await afterRun(context, run, runnersById);
    } catch (error) {
      context.logger.warn("could not follow up a run", { runId: run.id, error });
    }
  }
}

async function afterRun(
  context: TickContext,
  run: StoredRun,
  runnersById: ReadonlyMap<StoredRunner["id"], StoredRunner>,
): Promise<void> {
  if (run.state === "queued") return;
  const records = getRunWithRecords(context.db, run.id)?.records;
  if (records === undefined) return;
  // 트래커 갱신과 워크트리·PR 일은 서로 막지 않는다. 트래커가 실패해도(토큰 폐기, 장애) 워크트리는 정리한다.
  if (run.state !== "ended") {
    await attempt(context, run, "could not update the tracker", () =>
      markInProgress(context, run, records),
    );
    await attempt(context, run, "could not poll the run's pull request", () =>
      pollActivePullRequest(context, run),
    );
    return;
  }
  await attempt(context, run, "could not comment the run result", () =>
    commentResult(context, run, records),
  );
  if (run.startedAt !== null) {
    await attempt(context, run, "could not follow up the run's worktree", () =>
      followWorktree(context, run, records, runnersById),
    );
  } else {
    context.prPolledAt.delete(run.id);
  }
}

async function attempt(
  context: TickContext,
  run: StoredRun,
  message: string,
  work: () => Promise<void>,
): Promise<void> {
  try {
    await work();
  } catch (error) {
    context.logger.warn(message, { runId: run.id, error });
  }
}

// ---------- 트래커 갱신(Q41) ----------

/**
 * 시작한 런의 티켓을 Workspace에서 고른 "In Progress" 상태로 바꾼다. Queued인 동안은 바꾸지 않는다(Q68).
 * 고르지 않았으면 바꾸지 않는다. 바꾼 뒤 갱신 기록을 쓴다. 쓰기 전에 데몬이 멈추면 다시 띄웠을 때 같은
 * 상태로 한 번 더 바꿀 뿐이다.
 */
async function markInProgress(
  context: TickContext,
  run: ActiveRun,
  records: RunRecords,
): Promise<void> {
  if (records.trackerStateSetAt !== null || context.ticketsGone.has(run.id)) return;
  const stateId =
    getWorkspaceTrackerProject(context.db, run.ticket.connection, run.trackerProject)
      ?.inProgressStateId ?? null;
  if (stateId === null) return;
  const tracker = trackerFor(context, run);
  if (tracker === null) return;
  try {
    await tracker.setState(run.ticket.key, stateId);
  } catch (error) {
    if (!isTicketGone(error)) throw error;
    forgetGoneTicket(context, run);
    return;
  }
  tryWrite(context, run.id, () =>
    updateRunRecords(context.db, run.id, { trackerStateSetAt: context.now() }),
  );
}

/**
 * 끝난 런의 결과 댓글(요약 결과, 에이전트 결과, PR 상태, PR 링크)을 한 번 단다(Q41). 갱신 기록이 있으면 달지
 * 않는다. 댓글을 단 뒤 기록하기 전에 데몬이 멈췄을 수 있어, 달기 전에 트래커 댓글에서 이 런 ID를 찾는다.
 * 그 뒤 상태(In Review, Done)는 트래커의 코드 호스트 연동에 맡긴다(ADR 0001).
 */
async function commentResult(
  context: TickContext,
  run: EndedRun,
  records: RunRecords,
): Promise<void> {
  if (records.trackerComment !== null || context.ticketsGone.has(run.id)) return;
  let comment = context.unrecordedComments.get(run.id);
  if (comment === undefined) {
    const tracker = trackerFor(context, run);
    if (tracker === null) return;
    try {
      comment =
        (await findResultComment(tracker, run)) ??
        (await addResultComment(context, tracker, run, records));
    } catch (error) {
      if (!isTicketGone(error)) throw error;
      forgetGoneTicket(context, run);
      return;
    }
    context.unrecordedComments.set(run.id, comment);
  }
  const recorded = tryWrite(context, run.id, () =>
    updateRunRecords(context.db, run.id, { trackerComment: comment }),
  );
  if (recorded !== undefined) context.unrecordedComments.delete(run.id);
}

async function addResultComment(
  context: TickContext,
  tracker: Tracker,
  run: EndedRun,
  records: RunRecords,
): Promise<{ id: NonNullable<RunRecords["trackerComment"]>["id"]; at: Date }> {
  const { id } = await tracker.addComment(run.ticket.key, resultCommentBody(run, records));
  return { id, at: context.now() };
}

/** 앞서 단 이 런의 결과 댓글. 댓글 본문의 런 ID로 찾는다. */
async function findResultComment(
  tracker: Tracker,
  run: EndedRun,
): Promise<{ id: NonNullable<RunRecords["trackerComment"]>["id"]; at: Date } | null> {
  let after: string | null = null;
  do {
    const page = await tracker.listComments(run.ticket.key, after === null ? {} : { after });
    const found = page.items.find((comment) => comment.body.includes(run.id));
    if (found !== undefined) return { id: found.id, at: found.createdAt };
    after = page.nextCursor;
  } while (after !== null);
  return null;
}

/** 결과 댓글 본문. 요약 결과는 요약 계산 함수로만 정한다(CODING_STANDARDS). */
export function resultCommentBody(run: EndedRun, records: RunRecords): string {
  const m = messages.resultComment;
  const { outcome } = summarizeRunOutcome(run);
  const pr = records.pullRequest;
  return [
    m.title,
    "",
    `- ${m.summary}: ${messages.summary[outcome]}`,
    `- ${m.agentResult}: ${messages.agentResult[run.agentResult]}`,
    `- ${m.prState}: ${messages.prState[run.prState]}`,
    `- ${m.pr}: ${pr === null ? m.noPr : `[${pr.displayId}](${pr.url})`}`,
    "",
    `${m.runId}: \`${run.id}\``,
  ].join("\n");
}

function trackerFor(context: TickContext, run: StoredRun): Tracker | null {
  const tracker = context.adapters.tracker(context.db, run.ticket.connection);
  if (tracker === null) {
    context.logger.warn("run's tracker connection is not registered", { runId: run.id });
  }
  return tracker;
}

/** 트래커에서 티켓을 찾지 못한 오류인지(지워짐). 다시 해도 같으니 데몬이 살아 있는 동안 다시 하지 않는다. */
function isTicketGone(error: unknown): boolean {
  if (!(error instanceof AdapterError)) return false;
  const detail: unknown = error.detail;
  return (
    typeof detail === "object" && detail !== null && "kind" in detail && detail.kind === "not-found"
  );
}

function forgetGoneTicket(context: TickContext, run: StoredRun): void {
  context.logger.warn("run's ticket was not found in the tracker; skipping tracker updates", {
    runId: run.id,
  });
  context.ticketsGone.add(run.id);
}

// ---------- PR·CI 상태 ----------

/** 끝나지 않은 런과 이어진 PR과 CI 상태를 폴링해 쓴다(Run 상세, 0022). 아직 PR이 없으면 쓰지 않는다. */
async function pollActivePullRequest(context: TickContext, run: ActiveRun): Promise<void> {
  if (!pollDue(context, run)) return;
  const decision = await decideRunPrState(context, run);
  if (decision.pr === null) return;
  recordPullRequest(context, run, decision.pr);
}

function pollDue(context: TickContext, run: StoredRun): boolean {
  const now = context.now().getTime();
  const last = context.prPolledAt.get(run.id);
  if (last !== undefined && now - last < PR_POLL_INTERVAL_MS) return false;
  context.prPolledAt.set(run.id, now);
  return true;
}

function recordPullRequest(
  context: TickContext,
  run: StoredRun,
  pr: PullRequestSnapshot,
): boolean | undefined {
  const { id, displayId, url, ci } = pr;
  return tryWrite(context, run.id, () =>
    updateRunRecords(context.db, run.id, {
      pullRequest: { id, displayId, url, ci, checkedAt: context.now() },
    }),
  );
}

// ---------- 워크트리 정리(Q44·Q51·Q54·Q75) ----------

/**
 * 끝난 런의 워크트리를 요약 계산 함수의 워크트리 처리대로 다룬다. 브랜치는 지우지 않는다.
 * - 바로 지움: 지우고 지운 시각을 기록한다.
 * - PR이 병합되거나 닫힐 때까지 남김: PR을 폴링해 병합·닫힘이면 이후 PR 상태를 기록하고 지운다.
 * - 사람이 정함(러너 연결 끊김, 러너에 닿지 못한 채 끝난 운영자가 취소함): 지우지 않는다. 사람이 지웠는지는
 *   러너 확인이 본다(runner-check.ts, Q75).
 * - 지울 것 없음: 아무것도 하지 않는다.
 */
async function followWorktree(
  context: TickContext,
  run: StartedEndedRun,
  records: RunRecords,
  runnersById: ReadonlyMap<StoredRunner["id"], StoredRunner>,
): Promise<void> {
  const disposition = summarizeRunOutcome(run).worktree;
  // 더 폴링하지 않는 런의 폴링 시각은 잊는다.
  if (records.worktreeRemovedAt !== null || disposition !== "keep-until-pr-settles") {
    context.prPolledAt.delete(run.id);
  }
  if (records.worktreeRemovedAt !== null) return;
  switch (disposition) {
    case "remove-now":
      await removeWorktree(context, run, runnersById.get(run.runnerId));
      return;
    case "keep-until-pr-settles":
      if (
        records.laterPrState === null &&
        !(await recordSettledPullRequest(context, run, records))
      ) {
        return;
      }
      await removeWorktree(context, run, runnersById.get(run.runnerId));
      return;
    case "operator-decides":
    case "nothing-to-remove":
      return;
  }
}

/**
 * 남긴 런의 PR을 다시 조회해, 사람이 병합하거나 닫았으면 이후 PR 상태로 기록한다(Q54·Q69). 두 축은 바꾸지
 * 않는다. 기록했으면 참이다.
 */
async function recordSettledPullRequest(
  context: TickContext,
  run: StartedEndedRun,
  records: RunRecords,
): Promise<boolean> {
  if (!pollDue(context, run)) return false;
  const pr = await currentPullRequest(context, run, records);
  if (pr === null) return false;
  recordPullRequest(context, run, pr);
  // 모르는 PR 상태는 열림처럼 다뤄 워크트리를 남긴다(core decidePrState와 같은 쪽).
  const state = pr.state === "merged" ? "merged" : pr.state === "closed" ? "closed" : null;
  if (state === null) return false;
  const recorded = tryWrite(context, run.id, () =>
    updateRunRecords(context.db, run.id, { laterPrState: { state, at: context.now() } }),
  );
  return recorded === true;
}

/** 런이 끝날 때 이은 PR을 다시 조회한다. 이은 PR 기록이 없으면 런 시작 때처럼 찾는다. */
async function currentPullRequest(
  context: TickContext,
  run: StartedStoredRun,
  records: RunRecords,
): Promise<PullRequestSnapshot | null> {
  const linked = records.pullRequest;
  if (linked === null) return (await decideRunPrState(context, run)).pr;
  const codeHosts = context.adapters.allCodeHosts(context.db, (connectionId, error) => {
    context.logger.warn("could not create code host adapter", { connectionId, error });
  });
  for (const codeHost of codeHosts) {
    const repo = codeHost.repoOf(run.runnerProject);
    if (repo === null) continue;
    return codeHost.getPullRequest(repo, linked.id);
  }
  return null;
}

/**
 * 워크트리를 지우고 지운 시각을 기록한다. 러너가 등록에서 빠졌거나 Offline이면 다음 바퀴에 다시 해 본다.
 * 지우기가 실패했어도 워크트리가 이미 없으면(사람이 지움) 지운 시각을 기록한다.
 */
async function removeWorktree(
  context: TickContext,
  run: StartedEndedRun,
  stored: StoredRunner | undefined,
): Promise<void> {
  if (stored === undefined || !stored.online) return;
  const runner = context.adapters.runner(stored);
  try {
    await runner.removeWorktree(run.worktree);
  } catch (error) {
    const exists = await runner.worktreeExists(run.worktree).catch(() => true);
    if (exists) {
      context.logger.warn("could not remove a worktree", { runId: run.id, error });
      return;
    }
  }
  context.prPolledAt.delete(run.id);
  tryWrite(context, run.id, () =>
    updateRunRecords(context.db, run.id, { worktreeRemovedAt: context.now() }),
  );
}
