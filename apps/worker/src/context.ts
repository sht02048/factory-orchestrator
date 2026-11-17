import { AdapterError, decidePrState } from "@factory/core";
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
} from "@factory/core";
import { changeRunState, listRunners, setRunnerMailbox } from "@factory/db";
import type { Database, StoredRun, StoredRunner } from "@factory/db";
import type { WorkerAdapters } from "./adapters.js";

/** worker가 남기는 기록. 런 하나의 실패는 루프를 멈추지 않고 여기로 보낸다. */
export interface WorkerLogger {
  warn(message: string, fields?: Readonly<Record<string, unknown>>): void;
}

/** tick 사이에 이어지는 worker 상태. 재시작 뒤에도 이어져야 하는 것은 DB에 두고 여기에는 두지 않는다. */
export interface TickContext {
  db: Database;
  now: () => Date;
  logger: WorkerLogger;
  adapters: WorkerAdapters;
  /** 러너에 시작했다고 답을 받았지만 Running을 쓰지 못한 런. 다음 바퀴에 기록만 다시 한다. */
  pendingStarts: Map<RunId, PendingStart>;
  /** 이번 바퀴에 확인한 러너별 우편함. 바퀴마다 비운다 */
  mailboxes: Map<RunnerId, MailboxRef>;
  /**
   * 시작할 때 닿지 않은 러너와 다시 해 볼 시각. 그때까지 대기열 판단에서 Offline으로 본다(Q86). 러너 확인이
   * Offline을 적기 전에도 닿지 않는 러너가 capacity를 잡아 뒤 런을 막지 않게 한다. 메모리에만 둔다.
   */
  unreachableUntil: Map<RunnerId, number>;
  /**
   * 러너에 보냈지만 보냈다고 DB에 쓰지 못한 답(`<런 ID>\n<질문 ID>`). 데몬이 살아 있는 동안 다시 보내지 않고
   * 다음 바퀴에 표시만 다시 쓴다.
   */
  unmarkedAnswers: Set<string>;
  /** 러너에 보냈지만 보냈다고 DB에 쓰지 못한 권한 거절(`<런 ID>\n<권한 대기 ID>`). 답과 같이 다룬다. */
  unmarkedDenials: Set<string>;
  /**
   * 에이전트를 멈추거나 닫았지만 두 축을 쓰지 못한 런과 그때 정한 결과. 다음 바퀴에 기록만 다시 한다.
   * 데몬이 살아 있는 동안만 이어진다.
   */
  pendingEndings: Map<RunId, PendingEnding>;
  /** 런마다 마지막으로 PR·CI 상태를 폴링한 시각(epoch 밀리초). 다시 띄우면 한 번 더 폴링할 뿐이라 메모리에 둔다. */
  prPolledAt: Map<RunId, number>;
  /**
   * 트래커에 결과 댓글을 달았지만 DB에 쓰지 못한 런과 그 댓글. 데몬이 살아 있는 동안 다시 달지 않고 다음 바퀴에
   * 기록만 다시 한다. 다시 띄운 뒤에는 트래커의 댓글에서 런 ID를 찾아 다시 달지 않는다.
   */
  unrecordedComments: Map<RunId, { id: CommentId; at: Date }>;
  /** 결과 댓글을 달려 했는데 트래커에서 티켓을 찾지 못한 런. 데몬이 살아 있는 동안 다시 해 보지 않는다. */
  ticketsGone: Set<RunId>;
}

export interface PendingEnding {
  agentResult: AgentResult;
  report: CompletionReport | null;
  /** 에이전트를 멈추거나 닫기 전에 읽은 마지막 로그(Q46). 읽지 못했으면 null */
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

/** 러너와 워크트리가 있고 아직 끝나지 않은 런 */
export type ActiveRun = Exclude<StoredRun, { state: "queued" | "ended" }>;

/** 러너에서 시작한 런(끝났든 아니든). 러너·워크트리·브랜치·시작 시각이 있다 */
export type StartedStoredRun = Extract<StoredRun, { startedAt: Date }>;

export type QueuedStoredRun = Extract<StoredRun, { state: "queued" }>;

/**
 * 러너의 우편함을 확인하고(없거나 사라졌으면 어댑터가 다시 만든다, Q82.1) 바뀌었으면 DB에 쓴다.
 * 바퀴마다 러너당 한 번만 확인한다.
 */
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

/**
 * 런과 이어진 PR을 코드 호스트에서 찾아 core decidePrState로 PR 상태를 정한다(Q40·Q82.6).
 * 1순위는 시작 때 러너에서 받은 실제 브랜치, 2순위는 런 시작 뒤에 만든 PR의 티켓 키다.
 * 런의 러너 쪽 프로젝트를 저장소로 읽는 코드 호스트가 없으면 이을 PR이 없으니 없음이다.
 * 다만 어댑터를 만들지 못한 코드 호스트 연결이 있으면 그 연결이 이 저장소를 읽을 수 있으니,
 * 없음으로 확정하지 않고 던져 다음 바퀴에 다시 본다(두 축은 한 번만 기록한다, Q69).
 */
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

/** DB 쓰기. 실패하면(쓰기 잠금 시간 초과 등) 알리고 undefined를 돌려준다. */
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

/** 러너 어댑터가 던진 오류의 종류. 어댑터 오류가 아니면(트래커 오류 등) null이다. */
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

/** 러너에 닿지 못한 오류인지(ssh 실패 등). 연결 끊김 시계의 근거다(Q50·Q67). */
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
