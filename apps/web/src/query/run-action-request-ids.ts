import type { QueryClient } from "@tanstack/react-query";
import { MutationRejectedError } from "./mutation-error";

export const REQUEST_ID_RETRY_WINDOW_MS = 60_000;

interface KeptRequestId {
  requestId: string;
  keptAt: number;
  inFlight: number;
}

type RunRequestIds = Map<string, KeptRequestId>;

const requestIdsByClient = new WeakMap<QueryClient, Map<string, RunRequestIds>>();

function requestIdsOf(queryClient: QueryClient, runId: string): RunRequestIds {
  const byRun = requestIdsByClient.get(queryClient) ?? new Map<string, RunRequestIds>();
  requestIdsByClient.set(queryClient, byRun);
  const kept = byRun.get(runId) ?? new Map<string, KeptRequestId>();
  byRun.set(runId, kept);
  return kept;
}

export function newRunActionRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function keptFor(kept: RunRequestIds, intent: string, nowMs: number): KeptRequestId {
  const existing = kept.get(intent);
  if (
    existing !== undefined &&
    (existing.inFlight > 0 || nowMs - existing.keptAt < REQUEST_ID_RETRY_WINDOW_MS)
  ) {
    return existing;
  }
  const fresh = { requestId: newRunActionRequestId(), keptAt: nowMs, inFlight: 0 };
  kept.set(intent, fresh);
  return fresh;
}

function forgetSettled(kept: RunRequestIds): void {
  for (const [intent, entry] of kept) {
    if (entry.inFlight === 0) kept.delete(intent);
  }
}

export async function withRunActionRequestId<Value>(
  queryClient: QueryClient,
  runId: string,
  intent: string,
  call: (requestId: string) => Promise<Value>,
  nowMs: number = Date.now(),
): Promise<Value> {
  const kept = requestIdsOf(queryClient, runId);
  const entry = keptFor(kept, intent, nowMs);
  entry.inFlight += 1;
  try {
    const value = await call(entry.requestId);
    entry.inFlight -= 1;
    forgetSettled(kept);
    return value;
  } catch (error) {
    entry.inFlight -= 1;
    if (error instanceof MutationRejectedError && entry.inFlight === 0) kept.delete(intent);
    throw error;
  }
}
