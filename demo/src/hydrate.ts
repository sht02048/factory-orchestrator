import { toMailboxRef, toRepoRef } from "@ganger/core";
import type { PullRequestSnapshot, TicketKey } from "@ganger/core";
import {
  getRunWithRecords,
  listRunPermissionWaits,
  listRunQuestions,
  listRunners,
  listRuns,
} from "@ganger/db";
import type { Database, StoredRun } from "@ganger/db";
import { stringAt } from "./world.js";
import type { DemoWorld } from "./world.js";

export function hydrateWorld(db: Database, world: DemoWorld): void {
  const sshTargets = new Map(
    listRunners(db).map((runner) => [runner.id, stringAt(runner.config, "sshTarget")]),
  );
  for (const run of listRuns(db)) {
    if (run.state === "queued" || run.startedAt === null) continue;
    const records = getRunWithRecords(db, run.id)?.records;
    if (records?.pullRequest != null) {
      world.codeHost.putPullRequest(toRepoRef(run.runnerProject), {
        ...pullRequestOf(
          { ...run, ticketKey: run.ticket.key, headCommit: `demo-${run.id.slice(0, 8)}` },
          records.pullRequest,
        ),
        state: prStateOf(run, records.laterPrState?.state ?? null),
      });
    }
    const sshTarget = sshTargets.get(run.runnerId);
    if (run.state === "ended") {
      if (sshTarget !== undefined && records?.worktreeRemovedAt === null) {
        world.runner(sshTarget).recreatedWorktrees.set(run.worktree, run.branch);
      }
      continue;
    }
    if (sshTarget === undefined) continue;
    const runner = world.runner(sshTarget);
    const questions = listRunQuestions(db, run.id);
    runner.runs.set(run.worktreeName, {
      input: {
        mailbox: toMailboxRef("demo-mailbox"),
        project: run.runnerProject,
        worktreeName: run.worktreeName,
        agent: run.agent,
        ...(run.model === null ? {} : { model: run.model }),
        brief: "",
      },
      started: { worktree: run.worktree, branch: run.branch, agentRef: run.agentRef },
      questions: questions.map((q) => ({
        id: q.id,
        body: q.body,
        options: q.options,
        askedAt: q.askedAt,
      })),
      answers: questions.flatMap((q) =>
        q.answer?.sentAt == null ? [] : [{ questionId: q.id, answer: q.answer.text }],
      ),
      agentMessages: [],
      permissionWaits: listRunPermissionWaits(db, run.id)
        .filter((wait) => wait.resolvedAt === null && wait.denial === null)
        .map((wait) => ({ id: wait.id, detail: wait.detail, requestedAt: wait.requestedAt })),
      denials: [],
      report: null,
      endedWithoutReport: null,
      agentStopped: false,
      agentClosed: false,
      paused: run.state === "paused",
      resumes: [],
      log: ["$ claude", "Reading the ticket…", "Running the tests…"],
      activity: { kind: "unknown" },
      unreportedStop: null,
    });
  }
}

export function pullRequestOf(
  run: {
    headCommit: string;
    ticketKey: TicketKey;
    runnerProject: StoredRun["runnerProject"];
    startedAt: Date | null;
    branch: string;
  },
  pr: Pick<PullRequestSnapshot, "id" | "displayId" | "url"> &
    Partial<Pick<PullRequestSnapshot, "ci" | "signals">>,
): Omit<PullRequestSnapshot, "state"> {
  const createdAt = new Date((run.startedAt ?? new Date()).getTime() + 60_000);
  return {
    id: pr.id,
    displayId: pr.displayId,
    url: pr.url,
    title: `${run.ticketKey}: demo change`,
    body: `Fixes ${run.ticketKey}.`,
    createdAt,
    mergedAt: null,
    headBranch: run.branch,
    sourceRepo: toRepoRef(run.runnerProject),
    headCommit: run.headCommit,
    baseBranch: "main",
    ci: pr.ci ?? "success",
    signals: pr.signals ?? null,
  };
}

function prStateOf(
  run: StoredRun,
  later: "merged" | "closed" | null,
): PullRequestSnapshot["state"] {
  if (later !== null) return later;
  if (run.state !== "ended") return "open";
  return run.prState === "none" ? "open" : run.prState;
}
