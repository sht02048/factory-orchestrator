import { AdapterError, summarizeRunOutcome } from "@ganger/core";
import type { PullRequestSnapshot, Tracker } from "@ganger/core";
import {
  getRunWithRecords,
  getWorkspaceTrackerProject,
  listRunners,
  listRuns,
  markTrackerChanged,
  updateRunRecords,
} from "@ganger/db";
import type { RunRecords, StoredRun, StoredRunner } from "@ganger/db";
import { decideRunPrState, tryWrite } from "./context.js";
import type { ActiveRun, StartedStoredRun, TickContext } from "./context.js";
import { messages } from "./messages.js";

export const PR_POLL_INTERVAL_MS = 60_000;

type EndedRun = Extract<StoredRun, { state: "ended" }>;
type StartedEndedRun = Extract<EndedRun, { startedAt: Date }>;

export async function processAfterRuns(context: TickContext): Promise<void> {
  const runnersById = new Map(listRunners(context.db).map((runner) => [runner.id, runner]));
  const runs = listRuns(context.db, {
    states: ["running", "waiting-for-input", "paused", "disconnected", "ended"],
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
  tryWrite(context, run.id, () => {
    updateRunRecords(context.db, run.id, { trackerStateSetAt: context.now() });
    markTrackerChanged(context.db, run.ticket.connection);
  });
}

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

async function followWorktree(
  context: TickContext,
  run: StartedEndedRun,
  records: RunRecords,
  runnersById: ReadonlyMap<StoredRunner["id"], StoredRunner>,
): Promise<void> {
  const disposition = summarizeRunOutcome(run).worktree;
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

async function recordSettledPullRequest(
  context: TickContext,
  run: StartedEndedRun,
  records: RunRecords,
): Promise<boolean> {
  if (!pollDue(context, run)) return false;
  const pr = await currentPullRequest(context, run, records);
  if (pr === null) return false;
  recordPullRequest(context, run, pr);
  const state = pr.state === "merged" ? "merged" : pr.state === "closed" ? "closed" : null;
  if (state === null) return false;
  const recorded = tryWrite(context, run.id, () =>
    updateRunRecords(context.db, run.id, { laterPrState: { state, at: context.now() } }),
  );
  return recorded === true;
}

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
