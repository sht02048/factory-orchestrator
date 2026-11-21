import { usageLimitsAt } from "@ganger/core";
import { listRunners, toWorkspaceId } from "@ganger/db";
import type { Database, NotificationCause, NotificationTarget, StoredRunner } from "@ganger/db";
import { loadHomePage } from "../home/load.js";
import type { HomePage, HomeRun } from "../home/model.js";
import { ALL_WORKSPACES, runnerIssueCause } from "../shell/model.js";
import { localTimeZone } from "../time-zone.js";

function runTarget(run: HomeRun): NotificationTarget {
  return {
    kind: "run",
    runId: run.id,
    workspaceId: toWorkspaceId(run.workspace.id),
    ticketKey: run.ticketKey,
  };
}

function runCause(run: HomeRun): NotificationCause | null {
  const base = { target: runTarget(run), subject: run.ticketKey, detail: null };
  switch (run.state) {
    case "waiting-for-input": {
      const input = run.input;
      if (input?.kind === "question" && !input.answered) {
        return { ...base, kind: "question", cause: `question:${run.id}:${input.questionId}` };
      }
      if (input?.kind === "permission" && !input.denied) {
        return { ...base, kind: "permission", cause: `permission:${run.id}:${input.promptId}` };
      }
      return null;
    }
    case "disconnected":
      return { ...base, kind: "disconnected", cause: `disconnected:${run.id}` };
    case "ended":
      if (run.summary === "failed") return { ...base, kind: "failed", cause: `failed:${run.id}` };
      return null;
    case "queued":
    case "running":
    case "paused":
      return null;
  }
}

function runnerCauses(runner: StoredRunner, now: Date): NotificationCause[] {
  const base = {
    target: { kind: "runner", runnerId: runner.id } satisfies NotificationTarget,
    subject: runner.name,
  };
  const issue = runnerIssueCause(runner);
  if (issue === "offline") {
    return runner.checkedAt === null
      ? []
      : [{ ...base, kind: "runner-offline", cause: `runner-offline:${runner.id}`, detail: null }];
  }
  const causes: NotificationCause[] = [];
  if (issue === "auth") {
    causes.push({ ...base, kind: "runner-auth", cause: `runner-auth:${runner.id}`, detail: null });
  }
  for (const limit of usageLimitsAt(runner.providerUsage, now)) {
    causes.push({
      ...base,
      kind: "runner-usage-limit",
      cause: `runner-usage-limit:${runner.id}:${limit.provider}`,
      detail: limit.provider,
    });
  }
  return causes;
}

export function notificationCauses(
  page: HomePage,
  runners: ReadonlyArray<StoredRunner>,
  now: Date,
): NotificationCause[] {
  return [
    ...page.attention.flatMap(({ run }) => {
      const cause = runCause(run);
      return cause === null ? [] : [cause];
    }),
    ...runners.flatMap((runner) => runnerCauses(runner, now)),
  ];
}

export function loadNotificationCauses(db: Database, now: Date): NotificationCause[] {
  return notificationCauses(
    loadHomePage(db, ALL_WORKSPACES, now, localTimeZone()),
    listRunners(db),
    now,
  );
}
