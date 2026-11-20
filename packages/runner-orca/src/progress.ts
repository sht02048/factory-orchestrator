import { toPermissionRequestId, toQuestionId } from "@ganger/core";
import type {
  AgentActivity,
  AgentQuestion,
  CompletionReport,
  PermissionWait,
  QuestionId,
  RunProgress,
  UnreportedStop,
} from "@ganger/core";
import { mailPayloadSchema, taskReportSchema } from "./schemas.js";
import type {
  MailPayload,
  MailRow,
  WorkerShowResult,
  WorktreeAgent,
  WorktreePsResult,
} from "./schemas.js";

export interface ProgressInput {
  dispatchId: string;
  taskResult: string | Record<string, unknown> | null;
  worker: WorkerShowResult;
  mails: ReadonlyArray<MailRow>;
  worktreeRow: WorktreePsResult["worktrees"][number] | null | "unknown";
  worktreeExists: boolean | null;
  agentPaneKey?: string | null;
}

const ESCALATION_QUESTION_PREFIX = "escalation:";
const ORCA_STOP_MAIL_PREFIX = "msg_stop_";
const ORCA_FOLLOWUP_MAIL_PREFIX = "msg_followup_";
const UNREPORTED_STOP_REASONS: ReadonlySet<string> = new Set(["finished", "errored"]);
const LAST_OUTPUT_HEADING = "Last output:";
const FULL_OUTPUT_TRAILER = "Full output:";

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
    questions: mails.flatMap(({ mail, payload }) => [
      ...question(mail, payload),
      ...blockedEscalation(mail, payload),
    ]),
    permissionWaits: openPermissionWaits(mails),
    activity: activityOf(agentRowOf(input.worktreeRow, input.agentPaneKey ?? null)),
    unreportedStop: latestUnreportedStop(mails),
  };
}

export function escalationQuestionId(mailId: string): QuestionId {
  return toQuestionId(`${ESCALATION_QUESTION_PREFIX}${mailId}`);
}

export function isEscalationQuestion(id: QuestionId): boolean {
  return id.startsWith(ESCALATION_QUESTION_PREFIX);
}

export function needsAgentPaneKey(row: ProgressInput["worktreeRow"]): boolean {
  return row !== null && row !== "unknown" && (row.agents ?? []).length > 1;
}

function agentRowOf(
  row: ProgressInput["worktreeRow"],
  paneKey: string | null,
): WorktreeAgent | null {
  if (row === null || row === "unknown") return null;
  const agents = row.agents ?? [];
  if (paneKey !== null) return agents.find((agent) => agent.paneKey === paneKey) ?? null;
  return agents.length === 1 ? (agents[0] ?? null) : null;
}

function activityOf(agent: WorktreeAgent | null): AgentActivity {
  if (agent === null) return { kind: "unknown" };
  const main = agent.mainAgent ?? null;
  const startedMs = agent.stateStartedAt ?? main?.stateStartedAt ?? null;
  if (startedMs === null) return { kind: "unknown" };
  const since = new Date(startedMs);
  if (Number.isNaN(since.getTime())) return { kind: "unknown" };
  const state = agent.state ?? main?.state ?? null;
  if (state === "working") return { kind: "working", since };
  if (agent.interrupted === true || main?.outcome === "cancellation") {
    return { kind: "interrupted", since };
  }
  if (state === "done") return { kind: "turn-ended", since };
  return { kind: "unknown" };
}

function isOrcaStopNotice(mail: MailRow, payload: MailPayload | null): boolean {
  if (mail.type !== "escalation") return false;
  if (mail.id.startsWith(ORCA_FOLLOWUP_MAIL_PREFIX)) return true;
  const reason = payload?.stopReason ?? null;
  if (reason !== null) return UNREPORTED_STOP_REASONS.has(reason);
  return mail.id.startsWith(ORCA_STOP_MAIL_PREFIX);
}

function latestUnreportedStop(
  mails: ReadonlyArray<{ mail: MailRow; payload: MailPayload | null }>,
): UnreportedStop | null {
  let latest: UnreportedStop | null = null;
  for (const { mail, payload } of mails) {
    if (!isOrcaStopNotice(mail, payload)) continue;
    const at = parseDate(mail.created_at);
    if (at === null || (latest !== null && latest.at.getTime() >= at.getTime())) continue;
    latest = { at, lastOutput: lastOutputOf(mail.body) };
  }
  return latest;
}

export function lastOutputOf(body: string | null | undefined): string[] {
  const lines = (body ?? "").split("\n");
  const start = lines.indexOf(LAST_OUTPUT_HEADING);
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith(FULL_OUTPUT_TRAILER));
  return end === -1 ? rest : rest.slice(0, end);
}

function blockedEscalation(mail: MailRow, payload: MailPayload | null): AgentQuestion[] {
  if (mail.type !== "escalation") return [];
  if (mail.id.startsWith(ORCA_STOP_MAIL_PREFIX) || mail.id.startsWith(ORCA_FOLLOWUP_MAIL_PREFIX)) {
    return [];
  }
  if (payload === null) return [];
  const { stopReason, reason, approval } = payload;
  if ([stopReason, reason, approval].some((value) => value !== null && value !== undefined)) {
    return [];
  }
  const body = (mail.body ?? "").trim();
  return [
    {
      id: escalationQuestionId(mail.id),
      body: body === "" ? (mail.subject ?? "") : body,
      options: [],
      askedAt: parseDate(mail.created_at) ?? new Date(0),
    },
  ];
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
