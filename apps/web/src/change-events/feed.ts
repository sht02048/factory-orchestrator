import { log } from "@ganger/log";
import type { ChangeEvent, ChangeResume } from "@ganger/db";
import { sseMessage } from "../notifications/stream";

export const CHANGE_POLL_MS = 1_000;
export const CHANGE_HEARTBEAT_MS = 15_000;
export const CHANGE_RETRY_MS = 3_000;
export const CHANGE_READ_LIMIT = 500;

export interface ChangeSource {
  latest(): number;
  after(seq: number, limit: number): ChangeEvent[];
  resume(after: number): ChangeResume;
}

type Listener = (changes: ReadonlyArray<ChangeEvent>) => void;

export interface ChangeMessage {
  kind: ChangeEvent["kind"];
  targetId: string | null;
  workspaceId: string | null;
  part: ChangeEvent["part"];
}

function readAll(source: ChangeSource, after: number): ChangeEvent[] {
  const changes: ChangeEvent[] = [];
  let cursor = after;
  for (;;) {
    const page = source.after(cursor, CHANGE_READ_LIMIT);
    changes.push(...page);
    const last = page.at(-1);
    if (last === undefined || page.length < CHANGE_READ_LIMIT) return changes;
    cursor = last.seq;
  }
}

export class ChangeFeed {
  readonly #source: ChangeSource;
  readonly #pollMs: number;
  readonly #listeners = new Set<Listener>();
  #cursor = 0;
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(source: ChangeSource, options: { pollMs?: number } = {}) {
    this.#source = source;
    this.#pollMs = options.pollMs ?? CHANGE_POLL_MS;
  }

  get listenerCount(): number {
    return this.#listeners.size;
  }

  subscribe(listener: Listener): () => void {
    if (this.#listeners.size === 0) this.#start();
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) this.#stop();
    };
  }

  poll(): void {
    const changes = readAll(this.#source, this.#cursor);
    const last = changes.at(-1);
    if (last === undefined) return;
    this.#cursor = last.seq;
    for (const listener of this.#listeners) listener(changes);
  }

  #start(): void {
    this.#cursor = this.#source.latest();
    this.#timer = setInterval(() => {
      try {
        this.poll();
      } catch (error) {
        log().warn("change_events.read_failed", { error });
      }
    }, this.#pollMs);
  }

  #stop(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }
}

function changeMessage(change: ChangeEvent): string {
  const data: ChangeMessage = {
    kind: change.kind,
    targetId: change.targetId,
    workspaceId: change.workspaceId,
    part: change.part,
  };
  return sseMessage({ event: "change", id: change.seq, data });
}

export interface ChangeStreamOptions {
  after: number | null;
  feed: ChangeFeed;
  source: ChangeSource;
  heartbeatMs?: number;
}

export function changeStream(options: ChangeStreamOptions): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const heartbeatMs = options.heartbeatMs ?? CHANGE_HEARTBEAT_MS;
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    unsubscribe?.();
    if (heartbeat !== undefined) clearInterval(heartbeat);
    unsubscribe = undefined;
    heartbeat = undefined;
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string): boolean => {
        try {
          controller.enqueue(encoder.encode(text));
          return true;
        } catch {
          stop();
          return false;
        }
      };
      send(`retry: ${CHANGE_RETRY_MS}\n\n`);
      let cursor = Number.POSITIVE_INFINITY;
      unsubscribe = options.feed.subscribe((changes) => {
        for (const change of changes) {
          if (change.seq <= cursor) continue;
          if (!send(changeMessage(change))) return;
          cursor = change.seq;
        }
      });
      cursor = startCursor(options, send);
      send(sseMessage({ event: "ready", id: cursor, data: { seq: cursor } }));
      heartbeat = setInterval(
        () => send(sseMessage({ event: "heartbeat", data: null })),
        heartbeatMs,
      );
    },
    cancel() {
      stop();
    },
  });
}

function startCursor(options: ChangeStreamOptions, send: (text: string) => boolean): number {
  if (options.after === null) return options.source.latest();
  const resume = options.source.resume(options.after);
  if (resume.kind === "reset") {
    send(sseMessage({ event: "reset", id: resume.latest, data: { seq: resume.latest } }));
    return resume.latest;
  }
  let cursor = options.after;
  for (const change of readAll(options.source, options.after)) {
    send(changeMessage(change));
    cursor = change.seq;
  }
  return cursor;
}
