import { AdapterError, decidePrState } from "@ganger/core";
import type {
  AgentResult,
  CommentId,
  CompletionReport,
  MailboxRef,
  PermissionRequestId,
  PrStateDecision,
  QuestionId,
  RunId,
  Runner,
  RunnerErrorDetail,
  RunnerId,
  StartedRun,
} from "@ganger/core";
import { changeRunState, listRunners, setRunnerMailbox } from "@ganger/db";
import type { Database, StoredRun, StoredRunner } from "@ganger/db";
import type { WorkerAdapters } from "./adapters.js";
import type { AutoAssignState } from "./auto-assign.js";

export interface WorkerLogger {
  warn(message: string, fields?: Readonly<Record<string, unknown>>): void;
}

export interface TickContext {
  db: Database;
  now: () => Date;
  logger: WorkerLogger;
  adapters: WorkerAdapters;
  pendingStarts: Map<RunId, PendingStart>;
  mailboxes: Map<RunnerId, MailboxRef>;
  unreachableUntil: Map<RunnerId, number>;
  unmarkedAnswers: Set<string>;
  unmarkedDenials: Set<string>;
  pendingEndings: Map<RunId, PendingEnding>;
  resumesWithUnknownOutcome: Set<RunId>;
  prPolledAt: Map<RunId, number>;
  unrecordedComments: Map<RunId, { id: CommentId; at: Date }>;
  ticketsGone: Set<RunId>;
  autoAssign: AutoAssignState;
}

export interface PendingEnding {
  agentResult: AgentResult;
  report: CompletionReport | null;
  lastLog: ReadonlyArray<string> | null;
}

export interface PendingStart {
  runnerId: RunnerId;
  started: StartedRun;
}

export function answerKey(runId: RunId, questionId: QuestionId): string {
  return `${runId}\n${questionId}`;
}

export function denialKey(runId: RunId, permissionId: PermissionRequestId): string {
  return `${runId}\n${permissionId}`;
}

export type ActiveRun = Exclude<StoredRun, { state: "queued" | "ended" }>;

export type StartedStoredRun = Extract<StoredRun, { startedAt: Date }>;

export type QueuedStoredRun = Extract<StoredRun, { state: "queued" }>;

export async function mailboxFor(
  context: TickContext,
  storedRunner: StoredRunner,
  runner: Runner,
): Promise<MailboxRef> {
  const cached = context.mailboxes.get(storedRunner.id);
  if (cached !== undefined) return cached;
  const mailbox = await runner.ensureMailbox(storedRunner.mailbox);
  if (mailbox !== storedRunner.mailbox) {
    setRunnerMailbox(context.db, storedRunner.id, mailbox);
  }
  context.mailboxes.set(storedRunner.id, mailbox);
  return mailbox;
}

export async function decideRunPrState(
  context: TickContext,
  run: StartedStoredRun,
): Promise<PrStateDecision> {
  let unavailable = 0;
  const codeHosts = context.adapters.allCodeHosts(context.db, (connectionId, error) => {
    unavailable += 1;
    context.logger.warn("could not create code host adapter", { connectionId, error });
  });
  for (const codeHost of codeHosts) {
    const repo = codeHost.repoOf(run.runnerProject);
    if (repo === null) continue;
    const [byBranch, byTicketKey] = await Promise.all([
      codeHost.findPullRequestsByBranch(repo, run.branch),
      codeHost.findPullRequestsByTicketKey(repo, run.ticket.key, { createdSince: run.startedAt }),
    ]);
    return decidePrState({
      repo,
      ticketKey: run.ticket.key,
      runStartedAt: run.startedAt,
      byBranch,
      byTicketKey,
    });
  }
  if (unavailable > 0) {
    throw new Error(
      "no code host reads the run's project while some code host adapters are unavailable",
    );
  }
  context.logger.warn("no code host reads the run's project; recording no pull request", {
    runId: run.id,
    runnerProject: run.runnerProject,
  });
  return { prState: "none", pr: null };
}

export function tryWrite<T>(context: TickContext, runId: RunId, write: () => T): T | undefined {
  try {
    return write();
  } catch (error) {
    context.logger.warn("could not write run", { runId, error });
    return undefined;
  }
}

export function findRunner(db: Database, id: RunnerId): StoredRunner | undefined {
  return listRunners(db).find((runner) => runner.id === id);
}

export function runnerErrorDetail(error: unknown): RunnerErrorDetail | null {
  if (!(error instanceof AdapterError)) return null;
  const detail: unknown = error.detail;
  if (typeof detail !== "object" || detail === null || !("kind" in detail)) return null;
  switch (detail.kind) {
    case "unreachable":
    case "not-installed":
    case "not-ready":
    case "mailbox-missing":
    case "start-outcome-unknown":
      return { kind: detail.kind, detail: describe(detail) };
    case "malformed-output":
      return { kind: "malformed-output", raw: describe(detail) };
    case "runner-error":
      return {
        kind: "runner-error",
        code: "code" in detail && typeof detail.code === "string" ? detail.code : "unknown",
        message: describe(detail),
      };
    default:
      return null;
  }
}

export function isUnreachable(error: unknown): boolean {
  return runnerErrorDetail(error)?.kind === "unreachable";
}

export function describe(detail: object): string {
  return JSON.stringify(detail);
}

export function reportFailure(
  logger: WorkerLogger,
  runId: RunId,
  result: ReturnType<typeof changeRunState>,
): void {
  if (!result.ok) logger.warn("could not change run state", { runId, error: result.error });
}
