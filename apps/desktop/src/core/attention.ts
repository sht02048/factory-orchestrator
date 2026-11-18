import { z } from "zod";

export const ATTENTION_KINDS = ["question", "permission", "human-check", "runner-offline"] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

const eventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("question"),
    key: z.string(),
    runId: z.string(),
    ticketKey: z.string(),
  }),
  z.object({
    kind: z.literal("permission"),
    key: z.string(),
    runId: z.string(),
    ticketKey: z.string(),
  }),
  z.object({
    kind: z.literal("human-check"),
    key: z.string(),
    runId: z.string(),
    ticketKey: z.string(),
  }),
  z.object({
    kind: z.literal("runner-offline"),
    key: z.string(),
    runnerId: z.string(),
    runnerName: z.string(),
  }),
]);
export type AttentionEvent = z.infer<typeof eventSchema>;

export const attentionResponseSchema = z.object({
  events: z.array(z.unknown()).transform((items) =>
    items.flatMap((item) => {
      const parsed = eventSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

export async function fetchAttention(
  origin: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 5_000,
): Promise<AttentionEvent[] | undefined> {
  try {
    const response = await fetchImpl(new URL("/api/attention", origin), {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
    if (!response.ok) return undefined;
    const parsed = attentionResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.events : undefined;
  } catch {
    return undefined;
  }
}

export class AttentionDiff {
  private known: Set<string> | undefined;

  reset(): void {
    this.known = undefined;
  }

  next(events: ReadonlyArray<AttentionEvent>): AttentionEvent[] {
    const keys = new Set(events.map((event) => event.key));
    const previous = this.known;
    this.known = keys;
    if (previous === undefined) return [];
    return events.filter((event) => !previous.has(event.key));
  }
}

export function attentionPath(event: AttentionEvent): string {
  return event.kind === "runner-offline" ? "/runners" : `/runs/${encodeURIComponent(event.runId)}`;
}
