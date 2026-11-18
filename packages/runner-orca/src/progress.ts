import { toPermissionRequestId, toQuestionId } from "@factory/core";
import type { AgentQuestion, CompletionReport, PermissionWait, RunProgress } from "@factory/core";
import { mailPayloadSchema, taskReportSchema } from "./schemas.js";
import type { MailPayload, MailRow, WorkerShowResult, WorktreePsResult } from "./schemas.js";

export interface ProgressInput {
  dispatchId: string;
  taskResult: string | Record<string, unknown> | null;
  worker: WorkerShowResult;
  mails: ReadonlyArray<MailRow>;
  worktreeRow: WorktreePsResult["worktrees"][number] | null | "unknown";
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

function endedWithoutReport(
  input: ProgressInput,
  mails: ReadonlyArray<{ mail: MailRow; payload: MailPayload | null }>,
): string | null {
  const escalation = mails.find(
    ({ mail, payload }) =>
      mail.type === "escalation" &&
      (payload?.stopReason === "lost" || payload?.stopReason === "exited"),
  );
  if (escalation !== undefined) {
    return `${escalation.payload?.stopReason ?? "lost"}: ${escalation.mail.subject ?? firstLine(escalation.mail.body)}`;
  }
  if (input.worker.liveness === "exited") {
    return `agent exited: ${input.worker.lastError ?? input.worker.stage ?? input.worker.state}`;
  }
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
