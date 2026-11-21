import type { QueryClient } from "@tanstack/react-query";
import { MutationRejectedError } from "./mutation-error";

export const REQUEST_ID_RETRY_WINDOW_MS = 60_000;

interface KeptRequestId {
  requestId: string;
  content: string;
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

function keptFor(kept: RunRequestIds, slot: string, content: string, nowMs: number): KeptRequestId {
  const existing = kept.get(slot);
  if (
    existing?.content === content &&
    (existing.inFlight > 0 || nowMs - existing.keptAt < REQUEST_ID_RETRY_WINDOW_MS)
  ) {
    return existing;
  }
  const fresh = { requestId: newRunActionRequestId(), content, keptAt: nowMs, inFlight: 0 };
  kept.set(slot, fresh);
  return fresh;
}

export async function withRunActionRequestId<Value>(
  queryClient: QueryClient,
  runId: string,
  slot: string,
  content: string,
  call: (requestId: string) => Promise<Value>,
  clock: () => number = Date.now,
): Promise<Value> {
  const kept = requestIdsOf(queryClient, runId);
  const entry = keptFor(kept, slot, content, clock());
  const forget = (): void => {
    if (entry.inFlight === 0 && kept.get(slot) === entry) kept.delete(slot);
  };
  entry.inFlight += 1;
  try {
    const value = await call(entry.requestId);
    entry.inFlight -= 1;
    forget();
    return value;
  } catch (error) {
    entry.inFlight -= 1;
    if (error instanceof MutationRejectedError) forget();
    else entry.keptAt = clock();
    throw error;
  }
}
