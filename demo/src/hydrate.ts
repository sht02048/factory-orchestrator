import { toMailboxRef, toRepoRef } from "@factory/core";
import type { PullRequestSnapshot, TicketKey } from "@factory/core";
import {
  getRunWithRecords,
  listRunPermissionWaits,
  listRunQuestions,
  listRunners,
  listRuns,
} from "@factory/db";
import type { Database, StoredRun } from "@factory/db";
import { stringAt } from "./world.js";
import type { DemoWorld } from "./world.js";

/*
 * 가짜 러너와 코드 호스트는 메모리에만 있어, 띄울 때마다 DB 의 런에서 다시 만든다(티켓 0047). 그래야
 * 다시 띄운 뒤에도 worker 가 진행 중인 런을 러너에서 찾고(못 찾으면 워크트리 없음으로 끝낸다) 이은 PR 을 읽는다.
 * 트래커에 붙인 라벨과 새로 만든 티켓은 되살리지 않는다(fixtures.ts 의 목록에서 다시 시작한다).
 */

export function hydrateWorld(db: Database, world: DemoWorld): void {
  const sshTargets = new Map(
    listRunners(db).map((runner) => [runner.id, stringAt(runner.config, "sshTarget")]),
  );
  for (const run of listRuns(db)) {
    if (run.state === "queued" || run.startedAt === null) continue;
    const records = getRunWithRecords(db, run.id)?.records;
    if (records?.pullRequest != null) {
      world.codeHost.putPullRequest(toRepoRef(run.runnerProject), {
        ...pullRequestOf({ ...run, ticketKey: run.ticket.key }, records.pullRequest),
        state: prStateOf(run, records.laterPrState?.state ?? null),
      });
    }
    if (run.state === "ended") continue;
    const sshTarget = sshTargets.get(run.runnerId);
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
        prompt: "",
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
      permissionWaits: listRunPermissionWaits(db, run.id)
        .filter((wait) => wait.resolvedAt === null && wait.denial === null)
        .map((wait) => ({ id: wait.id, detail: wait.detail, requestedAt: wait.requestedAt })),
      denials: [],
      report: null,
      endedWithoutReport: null,
      agentStopped: false,
      agentClosed: false,
      log: ["$ claude", "Reading the ticket…", "Running the tests…"],
    });
  }
}

/** 런과 이은 PR 의 모양. 상태는 부르는 쪽이 정한다 */
export function pullRequestOf(
  run: {
    id: string;
    ticketKey: TicketKey;
    runnerProject: StoredRun["runnerProject"];
    startedAt: Date | null;
    branch: string;
  },
  pr: { id: PullRequestSnapshot["id"]; displayId: string; url: string },
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
    headCommit: `demo-${run.id.slice(0, 8)}`,
    baseBranch: "main",
    ci: "success",
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
