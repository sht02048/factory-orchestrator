export const MCP_ACTION_OUTCOMES = ["done", "rejected"] as const;
export type McpActionOutcome = (typeof MCP_ACTION_OUTCOMES)[number];
