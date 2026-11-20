import type { RunId } from "@ganger/core";
import { desc, eq, isNull } from "drizzle-orm";
import { recordRunChange, recordSettingsChange } from "./change-events.js";
import { inTransaction } from "./database.js";
import type { Database } from "./database.js";
import type { McpActionOutcome } from "./mcp-actions-model.js";
import { mcpActions } from "./schema.js";

export { MCP_ACTION_OUTCOMES } from "./mcp-actions-model.js";
export type { McpActionOutcome } from "./mcp-actions-model.js";

export interface McpActionInput {
  at: Date;
  client: string;
  tool: string;
  target: string | null;
  runId: RunId | null;
  outcome: McpActionOutcome;
  reason: string | null;
}

export interface StoredMcpAction extends McpActionInput {
  id: number;
}

export function recordMcpAction(db: Database, input: McpActionInput): void {
  inTransaction(db, () => {
    db.insert(mcpActions).values(input).run();
    if (input.runId !== null) recordRunChange(db, input.runId, { now: input.at });
    recordSettingsChange(db, undefined, input.at);
  });
}

const columns = {
  id: mcpActions.id,
  at: mcpActions.at,
  client: mcpActions.client,
  tool: mcpActions.tool,
  target: mcpActions.target,
  runId: mcpActions.runId,
  outcome: mcpActions.outcome,
  reason: mcpActions.reason,
};

export function listRunMcpActions(db: Database, runId: RunId): StoredMcpAction[] {
  return db
    .select(columns)
    .from(mcpActions)
    .where(eq(mcpActions.runId, runId))
    .orderBy(mcpActions.at, mcpActions.id)
    .all();
}

export function listRecentMcpActions(db: Database, limit: number): StoredMcpAction[] {
  return db
    .select(columns)
    .from(mcpActions)
    .where(isNull(mcpActions.runId))
    .orderBy(desc(mcpActions.at), desc(mcpActions.id))
    .limit(limit)
    .all();
}
