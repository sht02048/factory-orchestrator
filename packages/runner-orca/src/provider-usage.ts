import { USAGE_WINDOW_KINDS } from "@ganger/core";
import type {
  ProviderUsage,
  ProviderUsageReading,
  ProviderUsageStatus,
  UsageWindow,
} from "@ganger/core";
import { z } from "zod";

export const KNOWN_PROVIDERS: ReadonlyArray<string> = [
  "claude",
  "codex",
  "gemini",
  "cursor",
  "grok",
  "kimi",
  "minimax",
  "opencodeGo",
  "antigravity",
  "zcode",
];

const SIGNED_OUT = /not signed in|not logged in|sign-in/i;

const windowSchema = z
  .object({
    usedPercent: z.number().finite(),
    resetsAt: z.number().finite().nullish().catch(null),
  })
  .nullish()
  .catch(null);

const providerSchema = z.object({
  status: z.string(),
  error: z.string().nullish().catch(null),
  usageMetadata: z
    .object({ failureKind: z.string().nullish().catch(null) })
    .nullish()
    .catch(null),
  session: windowSchema,
  weekly: windowSchema,
  fableWeekly: windowSchema,
  monthly: windowSchema,
});

const accountListSchema = z.object({
  ok: z.literal(true),
  result: z.object({ rateLimits: z.record(z.string(), z.unknown()) }),
});

type ProviderRow = z.infer<typeof providerSchema>;

export function parseProviderUsage(stdout: string): ProviderUsageReading {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    return { kind: "unreadable" };
  }
  const parsed = accountListSchema.safeParse(json);
  if (!parsed.success) return { kind: "unreadable" };
  const rateLimits = parsed.data.result.rateLimits;
  const providers: ProviderUsage[] = [];
  for (const provider of KNOWN_PROVIDERS) {
    const row = providerSchema.safeParse(rateLimits[provider]);
    if (row.success) providers.push(toProviderUsage(provider, row.data));
  }
  return { kind: "read", providers };
}

function toProviderUsage(provider: string, row: ProviderRow): ProviderUsage {
  const status = statusOf(row);
  if (status !== "ok") return { provider, status, windows: [] };
  const windows: UsageWindow[] = [];
  for (const kind of USAGE_WINDOW_KINDS) {
    const window = row[kind];
    if (window === null || window === undefined) continue;
    windows.push({
      kind,
      usedPercent: window.usedPercent,
      resetsAt:
        window.resetsAt === null || window.resetsAt === undefined
          ? null
          : new Date(window.resetsAt),
    });
  }
  return { provider, status, windows };
}

function statusOf(row: ProviderRow): ProviderUsageStatus {
  if (row.status === "ok") return "ok";
  if (row.status !== "unavailable") return "error";
  const signedOut =
    row.usageMetadata?.failureKind === "missing-credentials" ||
    (row.error !== null && row.error !== undefined && SIGNED_OUT.test(row.error));
  return signedOut ? "signed-out" : "unavailable";
}
