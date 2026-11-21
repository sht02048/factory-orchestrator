import { z } from "zod";
import { WEBHOOK_PING_PREFIX, hostnameOfHostHeader } from "./request-guard.js";

export const WEBHOOK_PING_PRODUCT = "ganger";

export const WEBHOOK_CHECK_TIMEOUT_MS = 8_000;

export const WEBHOOK_PING_MAX_BYTES = 1024;

export const FUNNEL_PORT = 8443;

export const webhookPingSchema = z.object({
  product: z.literal(WEBHOOK_PING_PRODUCT),
  match: z.boolean(),
});
export type WebhookPing = z.infer<typeof webhookPingSchema>;

export function webhookPingPath(instanceId: string): string {
  return `${WEBHOOK_PING_PREFIX}${encodeURIComponent(instanceId)}`;
}

export function webhookPingAnswer(storedInstanceId: string, askedInstanceId: string): Response {
  const match = storedInstanceId === askedInstanceId;
  const body: WebhookPing = { product: WEBHOOK_PING_PRODUCT, match };
  return Response.json(body, {
    status: match ? 200 : 404,
    headers: { "cache-control": "no-store" },
  });
}

const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/u;

function isPublicDnsName(hostname: string): boolean {
  if (hostname.startsWith("[") || IPV4_LITERAL.test(hostname)) return false;
  if (!hostname.includes(".")) return false;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return false;
  return !hostname.endsWith(".local") && !hostname.endsWith(".internal");
}

export function parseWebhookAddress(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  const plain =
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === "";
  if (!plain) return null;
  const hostname = hostnameOfHostHeader(url.host);
  if (hostname === null || !isPublicDnsName(hostname)) return null;
  return url.origin;
}

export type WebhookAddressFailure =
  | "invalid-address"
  | "name-not-found"
  | "unreachable"
  | "other-server"
  | "check-failed";

export type WebhookAddressCheck =
  | { ok: true; address: string }
  | { ok: false; reason: WebhookAddressFailure };

export type PingFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface WebhookAddressCheckDeps {
  fetch: PingFetch;
  instanceId: string;
  timeoutMs?: number;
}

const NAME_NOT_FOUND = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_NONAME", "EAI_FAIL"]);
const UNREACHABLE = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const errorShape = z.object({
  name: z.string().optional().catch(undefined),
  code: z.string().optional().catch(undefined),
  cause: z.unknown().optional(),
});

function errorCodes(error: unknown): { names: string[]; codes: string[] } {
  const names: string[] = [];
  const codes: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth += 1) {
    const parsed = errorShape.safeParse(current);
    if (!parsed.success) break;
    if (parsed.data.name !== undefined) names.push(parsed.data.name);
    if (parsed.data.code !== undefined) codes.push(parsed.data.code);
    current = parsed.data.cause;
  }
  return { names, codes };
}

export function classifyPingError(error: unknown): WebhookAddressFailure {
  const { names, codes } = errorCodes(error);
  if (codes.some((code) => NAME_NOT_FOUND.has(code))) return "name-not-found";
  if (names.includes("TimeoutError") || names.includes("AbortError")) return "unreachable";
  if (codes.some((code) => UNREACHABLE.has(code))) return "unreachable";
  return "check-failed";
}

type BodyRead = { ok: true; text: string } | { ok: false };

async function readSmallBody(response: Response, limit: number): Promise<BodyRead> {
  if (response.body === null) return { ok: true, text: "" };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const read: { done: boolean; value?: unknown } = await reader.read();
    if (read.done) break;
    const value = read.value;
    if (!(value instanceof Uint8Array)) {
      await reader.cancel().catch(() => undefined);
      return { ok: false };
    }
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return { ok: false };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(bytes) };
}

function isThisServer(text: string): boolean {
  try {
    const parsed = webhookPingSchema.safeParse(JSON.parse(text));
    return parsed.success && parsed.data.match;
  } catch {
    return false;
  }
}

export async function checkWebhookAddress(
  input: string,
  deps: WebhookAddressCheckDeps,
): Promise<WebhookAddressCheck> {
  const address = parseWebhookAddress(input);
  if (address === null) return { ok: false, reason: "invalid-address" };
  const signal = AbortSignal.timeout(deps.timeoutMs ?? WEBHOOK_CHECK_TIMEOUT_MS);
  try {
    const response = await deps.fetch(`${address}${webhookPingPath(deps.instanceId)}`, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: { accept: "application/json" },
    });
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, reason: "other-server" };
    }
    const body = await readSmallBody(response, WEBHOOK_PING_MAX_BYTES);
    if (!body.ok || !isThisServer(body.text)) return { ok: false, reason: "other-server" };
    return { ok: true, address };
  } catch (error) {
    return { ok: false, reason: classifyPingError(error) };
  }
}

export function funnelCommand(
  cli: string,
  port: number,
  { host = "127.0.0.1", funnelPort = FUNNEL_PORT }: { host?: string; funnelPort?: number } = {},
): string {
  const target = `http://${host}:${String(port)}/api/webhooks/`;
  return [
    shellWord(cli),
    "funnel",
    "--bg",
    `--https=${String(funnelPort)}`,
    "--set-path",
    "/api/webhooks/",
    target,
  ].join(" ");
}

function shellWord(value: string): string {
  return /^[A-Za-z0-9_./:=-]+$/u.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

export function funnelAddress(host: string, funnelPort: number = FUNNEL_PORT): string {
  return funnelPort === 443 ? `https://${host}` : `https://${host}:${String(funnelPort)}`;
}
