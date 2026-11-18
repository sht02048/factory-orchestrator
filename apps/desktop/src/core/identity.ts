import { z } from "zod";

export const PRODUCT_NAME = "ganger";

export const identitySchema = z.object({
  product: z.literal(PRODUCT_NAME),
  version: z.string(),
  instanceId: z.string().min(1),
  webAccess: z.enum(["allowed", "host-not-allowed"]).catch("host-not-allowed"),
});
export type Identity = z.infer<typeof identitySchema>;

export type ProbeResult =
  | { kind: "ours"; identity: Identity }
  | { kind: "not-ours" }
  | { kind: "unreachable" };

export type Probe = (origin: string, timeoutMs: number) => Promise<ProbeResult>;

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
