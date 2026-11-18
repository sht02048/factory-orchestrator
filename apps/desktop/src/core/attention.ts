import { z } from "zod";

/*
 * 알림(Q4). 앱이 서버의 `GET /api/attention`(apps/web/src/attention)을 폴링하고, 앞 응답에 없던 사건만 OS 알림으로
 * 띄운다. 알리는 것은 질문 대기(Question), 권한 대기(Permission), Human Check, 러너 Offline(Runner Issue) 넷이다.
 * Merged·Failed 는 서버가 담지 않고, 앱도 모르는 종류는 버린다. 로컬·원격 모드가 같다.
 *
 * 앱을 연 뒤 처음 받은 응답은 기준으로만 삼고 알리지 않는다. 그동안 쌓인 일은 창의 Home 이 보인다.
 */

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

/** 모르는 종류(서버가 나중에 더한 것)는 버리고 나머지만 읽는다 */
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

/** 앞 응답과 견줘 새로 생긴 사건을 고른다 */
export class AttentionDiff {
  private known: Set<string> | undefined;

  /** 서버를 바꾸면 기준을 다시 잡는다 */
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

/** 알림을 누르면 열 화면 경로 */
export function attentionPath(event: AttentionEvent): string {
  return event.kind === "runner-offline" ? "/runners" : `/runs/${encodeURIComponent(event.runId)}`;
}
