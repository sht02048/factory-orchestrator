export const LOG_LEVELS = ["error", "warn", "info", "debug"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const PROCESS_NAMES = ["web", "worker", "mcp", "cli", "desktop"] as const;
export type ProcessName = (typeof PROCESS_NAMES)[number];

export const CONTEXT_KEYS = [
  "runId",
  "ticketKey",
  "runnerId",
  "workspaceId",
  "trackerConnectionId",
  "codeHostConnectionId",
  "deliveryId",
  "requestId",
  "orcaRunId",
  "worktreeName",
  "prId",
  "tool",
] as const;

export const DETAIL_KEYS = [
  "verb",
  "ms",
  "exit",
  "outcome",
  "reason",
  "kind",
  "from",
  "to",
  "online",
  "count",
  "watched",
  "lastTickMs",
  "uptimeS",
  "signal",
  "code",
  "status",
  "method",
  "path",
  "host",
  "origin",
  "labelId",
  "runnerProject",
  "control",
  "questionId",
  "permissionId",
  "requestKind",
  "child",
  "node",
  "platform",
  "arch",
  "logLevel",
  "migrated",
] as const;

export type ContextKey = (typeof CONTEXT_KEYS)[number];
export type DetailKey = (typeof DETAIL_KEYS)[number];
export type FieldKey = ContextKey | DetailKey;
export type LogValue = string | number | boolean | null;

export type LogContext = { readonly [K in ContextKey]?: LogValue };

export type LogFields = { readonly [K in FieldKey]?: LogValue | undefined } & {
  readonly error?: unknown;
};

const FIELD_KEYS: ReadonlySet<string> = new Set<string>([...CONTEXT_KEYS, ...DETAIL_KEYS]);

export function isFieldKey(key: string): key is FieldKey {
  return FIELD_KEYS.has(key);
}

export function levelRank(level: LogLevel): number {
  return LOG_LEVELS.indexOf(level);
}

export function isEnabled(level: LogLevel, threshold: LogLevel): boolean {
  return levelRank(level) <= levelRank(threshold);
}
