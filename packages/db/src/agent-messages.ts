import { acceptsAgentMessage } from "@ganger/core";
import type { AgentMessageRequestId, RunId } from "@ganger/core";
import { and, asc, eq, isNull } from "drizzle-orm";
import { recordRunChange } from "./change-events.js";
import type { Database } from "./database.js";
import { inTransaction } from "./database.js";
import { hasPendingCancelRequest } from "./requests.js";
import { runAgentMessages, runs } from "./schema.js";

export type RequestAgentMessageResult =
  | { ok: true; id: number; requestedAt: Date }
  | { ok: false; reason: "not-found" | "not-accepting" | "cancelling" };

export function requestAgentMessage(
  db: Database,
  runId: RunId,
  input: { requestId: AgentMessageRequestId; body: string },
  now: Date = new Date(),
): RequestAgentMessageResult {
  return inTransaction(db, (): RequestAgentMessageResult => {
    const existing = db
      .select({ id: runAgentMessages.id, requestedAt: runAgentMessages.requestedAt })
      .from(runAgentMessages)
      .where(
        and(eq(runAgentMessages.runId, runId), eq(runAgentMessages.requestId, input.requestId)),
      )
      .get();
    if (existing !== undefined) return { ok: true, ...existing };
    const run = db.select({ state: runs.state }).from(runs).where(eq(runs.id, runId)).get();
    if (run === undefined) return { ok: false, reason: "not-found" };
    if (!acceptsAgentMessage(run.state)) return { ok: false, reason: "not-accepting" };
    if (hasPendingCancelRequest(db, runId)) return { ok: false, reason: "cancelling" };
    const inserted = db
      .insert(runAgentMessages)
      .values({ runId, requestId: input.requestId, body: input.body, requestedAt: now })
      .returning({ id: runAgentMessages.id })
      .get();
    recordRunChange(db, runId, { now });
    return { ok: true, id: inserted.id, requestedAt: now };
  });
}

export interface PendingAgentMessage {
  id: number;
  runId: RunId;
  body: string;
  sendStartedAt: Date | null;
}

export function listPendingAgentMessages(db: Database): PendingAgentMessage[] {
  return db
    .select({
      id: runAgentMessages.id,
      runId: runAgentMessages.runId,
      body: runAgentMessages.body,
      sendStartedAt: runAgentMessages.sendStartedAt,
    })
    .from(runAgentMessages)
    .where(isNull(runAgentMessages.completedAt))
    .orderBy(asc(runAgentMessages.id))
    .all();
}

export function markAgentMessageSending(db: Database, id: number, now: Date): boolean {
  return (
    db
      .update(runAgentMessages)
      .set({ sendStartedAt: now })
      .where(
        and(
          eq(runAgentMessages.id, id),
          isNull(runAgentMessages.sendStartedAt),
          isNull(runAgentMessages.completedAt),
        ),
      )
      .run().changes > 0
  );
}

export function completeAgentMessage(
  db: Database,
  input: { id: number; runId: RunId; completedAt: Date; error: string | null },
): boolean {
  return inTransaction(db, () => {
    const completed =
      db
        .update(runAgentMessages)
        .set({ completedAt: input.completedAt, error: input.error })
        .where(and(eq(runAgentMessages.id, input.id), isNull(runAgentMessages.completedAt)))
        .run().changes > 0;
    if (completed) recordRunChange(db, input.runId, { now: input.completedAt });
    return completed;
  });
}

export interface StoredAgentMessage {
  id: number;
  body: string;
  requestedAt: Date;
  completedAt: Date | null;
  error: string | null;
}

export function listRunAgentMessages(db: Database, runId: RunId): StoredAgentMessage[] {
  return db
    .select({
      id: runAgentMessages.id,
      body: runAgentMessages.body,
      requestedAt: runAgentMessages.requestedAt,
      completedAt: runAgentMessages.completedAt,
      error: runAgentMessages.error,
    })
    .from(runAgentMessages)
    .where(eq(runAgentMessages.runId, runId))
    .orderBy(asc(runAgentMessages.id))
    .all();
}
