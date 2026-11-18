import { z } from "zod";

/*
 * 신원 확인 경로 `GET /api/identity`(티켓 0048 「신원 확인 경로 계약」)를 묻는다. 서버(web)의 identitySchema 와 같은
 * 계약이다. 앱은 모르는 필드를 무시하고 모르는 webAccess 값은 "host-not-allowed" 로 읽는다.
 */

export const PRODUCT_NAME = "factory-orchestrator";

export const identitySchema = z.object({
  product: z.literal(PRODUCT_NAME),
  version: z.string(),
  instanceId: z.string().min(1),
  webAccess: z.enum(["allowed", "host-not-allowed"]).catch("host-not-allowed"),
});
export type Identity = z.infer<typeof identitySchema>;

export type ProbeResult =
  | { kind: "ours"; identity: Identity }
  /** 응답은 왔지만 우리 서버가 아니다(다른 서비스, 모양이 다른 응답) */
  | { kind: "not-ours" }
  /** 연결이 안 되거나 시간 안에 답하지 않았다 */
  | { kind: "unreachable" };

export type Probe = (origin: string, timeoutMs: number) => Promise<ProbeResult>;

/** `origin`(scheme://host[:port]) 의 신원 확인 경로를 한 번 묻는다 */
export async function probeIdentity(
  origin: string,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ProbeResult> {
  let response: Response;
  try {
    response = await fetchImpl(new URL("/api/identity", origin), {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
      headers: { accept: "application/json" },
    });
  } catch {
    return { kind: "unreachable" };
  }
  if (!response.ok) return { kind: "not-ours" };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: "not-ours" };
  }
  const parsed = identitySchema.safeParse(body);
  return parsed.success ? { kind: "ours", identity: parsed.data } : { kind: "not-ours" };
}
