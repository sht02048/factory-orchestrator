import { toPermissionRequestId, toQuestionId } from "@factory/core";
import type { AgentQuestion, CompletionReport, PermissionWait, RunProgress } from "@factory/core";
import { mailPayloadSchema, taskReportSchema } from "./schemas.js";
import type { MailPayload, MailRow, WorkerShowResult, WorktreePsResult } from "./schemas.js";

/**
 * 러너에서 읽은 출력으로 런의 실제 상태 하나를 고른다(core RunProgress, research 0008 「pollRun 판정 순서」).
 * 순서는 core 계약대로 완료 보고 → 보고 없이 사라짐 → 워크트리 사라짐 → 그 밖(돌고 있음)이다.
 * 모르는 상태 값은 돌고 있음으로 다룬다.
 */
export interface ProgressInput {
  dispatchId: string;
  /** 이 런의 Task 행의 `result`. task-list를 읽지 않았거나 없으면 null */
  taskResult: string | Record<string, unknown> | null;
  worker: WorkerShowResult;
  /** 우편함의 아직 처리되지 않은 메일 전부(check --peek). 이 함수가 이 런의 것만 고른다 */
  mails: ReadonlyArray<MailRow>;
  /**
   * 이 런의 워크트리 행(worktree ps --agent-wait). 행이 없으면 null, 목록이 잘려 행이 없다고 말할 수
   * 없으면 "unknown"이다.
   */
  worktreeRow: WorktreePsResult["worktrees"][number] | null | "unknown";
  /** 워크트리가 있는지 따로 확인한 값(worktree show). 확인하지 않았으면 null */
  worktreeExists: boolean | null;
}

export function decideProgress(input: ProgressInput): RunProgress {
  const report = completionReport(input.taskResult);
  if (report !== null) return { kind: "reported", report };

  const mails = input.mails
    .map((mail) => ({ mail, payload: parsePayload(mail.payload) }))
    .filter(({ payload }) => payload?.dispatchId === input.dispatchId);

  const gone = endedWithoutReport(input, mails);
  if (gone !== null) return { kind: "ended-without-report", detail: gone };

  if (input.worktreeExists === false) return { kind: "worktree-gone" };

  return {
    kind: "active",
    questions: mails.flatMap(({ mail, payload }) => question(mail, payload)),
    permissionWaits: openPermissionWaits(mails),
  };
}

/** Task 결과가 완료 보고(`provenance: "worker_report"`)이고 outcome이 있으면 보고를 돌려준다. */
export function completionReport(
  result: string | Record<string, unknown> | null,
): CompletionReport | null {
  if (result === null) return null;
  const parsed = taskReportSchema.safeParse(
    typeof result === "string" ? parseJson(result) : result,
  );
  if (!parsed.success) return null;
  const { provenance, outcome, body, subject, completedAt } = parsed.data;
  if (provenance !== "worker_report" || outcome === null || outcome === undefined) return null;
  return {
    outcome,
    body: body ?? subject ?? "",
    reportedAt: parseDate(completedAt),
  };
}

/** 에이전트가 완료 보고 없이 사라졌다는 증거(Q82.19). 없으면 null */
function endedWithoutReport(
  input: ProgressInput,
  mails: ReadonlyArray<{ mail: MailRow; payload: MailPayload | null }>,
): string | null {
  // Orca가 보고 없이 사라졌다고 알렸다(`lost`, `exited`, research 0008 5절).
  const escalation = mails.find(
    ({ mail, payload }) =>
      mail.type === "escalation" &&
      (payload?.stopReason === "lost" || payload?.stopReason === "exited"),
  );
  if (escalation !== undefined) {
    return `${escalation.payload?.stopReason ?? "lost"}: ${escalation.mail.subject ?? firstLine(escalation.mail.body)}`;
  }
  // 에이전트 터미널이 사라졌다(worker-show liveness exited). 완료 보고가 없을 때만 여기 온다.
  if (input.worker.liveness === "exited") {
    return `agent exited: ${input.worker.lastError ?? input.worker.stage ?? input.worker.state}`;
  }
  // 셸만 남고 에이전트가 워크트리 목록에서 사라졌다. Orca는 이 상태를 알리지 않고 `unverifiable`로 둔다
  // (research 0008 5절, 0004 3절). 시작 직후 에이전트가 목록에 오르기 전에는 liveness가 live라 걸리지 않는다.
  const row = input.worktreeRow;
  if (
    input.worker.liveness === "unverifiable" &&
    row !== null &&
    row !== "unknown" &&
    (row.agents ?? []).length === 0 &&
    (row.liveTerminalCount ?? 0) > 0
  ) {
    return "agent exited and only its shell is left in the worktree";
  }
  return null;
}

function question(mail: MailRow, payload: MailPayload | null): AgentQuestion[] {
  if (mail.type !== "question") return [];
  return [
    {
      id: toQuestionId(mail.id),
      body: mail.body ?? "",
      options: payload?.options ?? [],
      askedAt: parseDate(mail.created_at) ?? new Date(0),
    },
  ];
}

/**
 * 아직 열린 권한 대기(`needs-input` escalation의 `approval.state: "open"`). 같은 approvalId에 열림이 아닌
 * 상태의 메일(`Worker approval answered`, research 0008 4절)이 오면 닫힌 것으로 본다.
 */
function openPermissionWaits(
  mails: ReadonlyArray<{ mail: MailRow; payload: MailPayload | null }>,
): PermissionWait[] {
  const closed = new Set<string>();
  for (const { payload } of mails) {
    const approval = payload?.approval;
    if (approval !== null && approval !== undefined && approval.state !== "open") {
      closed.add(approval.approvalId);
    }
  }
  const waits = new Map<string, PermissionWait>();
  for (const { mail, payload } of mails) {
    const approval = payload?.approval;
    if (mail.type !== "escalation" || payload?.stopReason !== "needs-input") continue;
    if (approval === null || approval === undefined || approval.state !== "open") continue;
    if (closed.has(approval.approvalId) || waits.has(approval.approvalId)) continue;
    const { title, detail } = approval.summary ?? {};
    waits.set(approval.approvalId, {
      id: toPermissionRequestId(approval.approvalId),
      detail:
        [title, detail].filter((part) => part !== null && part !== undefined).join(": ") ||
        (mail.subject ?? ""),
      requestedAt: parseDate(mail.created_at) ?? new Date(0),
    });
  }
  return [...waits.values()];
}

function parsePayload(payload: MailRow["payload"]): MailPayload | null {
  if (payload === null || payload === undefined) return null;
  const parsed = mailPayloadSchema.safeParse(
    typeof payload === "string" ? parseJson(payload) : payload,
  );
  return parsed.success ? parsed.data : null;
}

function parseJson(value: string): unknown {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    return null;
  }
}

function parseDate(value: string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function firstLine(value: string | null | undefined): string {
  return (value ?? "").split("\n", 1)[0] ?? "";
}
