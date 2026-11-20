import type {
  Page,
  Paged,
  Tracker,
  TrackerConnectionId,
  TrackerLabel,
  TrackerProject,
  TrackerProjectId,
  TrackerState,
  TrackerTicket,
} from "@ganger/core";
import { trackerReadGeneration } from "@ganger/db";
import type { Database } from "@ganger/db";

export const TRACKER_READ_FRESH_MS = 30_000;
export const TRACKER_READ_MAX_AGE_MS = 5 * 60_000;

export interface TrackerReadTiming {
  now: () => number;
  freshMs: number;
  maxAgeMs: number;
}

interface Entry<T> {
  value: T;
  fetchedAt: number;
  generation: number;
}

interface Running<T> {
  promise: Promise<T>;
  generation: number;
}

class StaleWhileRevalidate<T> {
  readonly #entries = new Map<string, Entry<T>>();
  readonly #running = new Map<string, Running<T>>();
  readonly #timing: TrackerReadTiming;

  constructor(timing: TrackerReadTiming) {
    this.#timing = timing;
  }

  read(key: string, generation: number, fetch: () => Promise<T>): Promise<T> {
    const entry = this.#entries.get(key);
    if (entry !== undefined && entry.generation === generation) {
      const age = this.#timing.now() - entry.fetchedAt;
      if (age < this.#timing.freshMs) return Promise.resolve(entry.value);
      if (age < this.#timing.maxAgeMs) {
        this.#fetch(key, generation, fetch).catch(() => undefined);
        return Promise.resolve(entry.value);
      }
    }
    return this.#fetch(key, generation, fetch);
  }

  #fetch(key: string, generation: number, fetch: () => Promise<T>): Promise<T> {
    const running = this.#running.get(key);
    if (running !== undefined && running.generation === generation) return running.promise;
    const startedAt = this.#timing.now();
    const promise = fetch()
      .then((value) => {
        this.#forgetOutdated(generation);
        const current = this.#entries.get(key);
        if (current === undefined || current.generation <= generation)
          this.#entries.set(key, { value, fetchedAt: startedAt, generation });
        return value;
      })
      .finally(() => {
        if (this.#running.get(key)?.promise === promise) this.#running.delete(key);
      });
    this.#running.set(key, { promise, generation });
    return promise;
  }

  get size(): number {
    return this.#entries.size;
  }

  #forgetOutdated(generation: number): void {
    const now = this.#timing.now();
    for (const [key, entry] of this.#entries) {
      if (entry.generation < generation || now - entry.fetchedAt >= this.#timing.maxAgeMs)
        this.#entries.delete(key);
    }
  }
}

interface ConnectionReads {
  tickets: StaleWhileRevalidate<Paged<TrackerTicket>>;
  projects: StaleWhileRevalidate<ReadonlyArray<TrackerProject>>;
  labels: StaleWhileRevalidate<ReadonlyArray<TrackerLabel>>;
  states: StaleWhileRevalidate<ReadonlyArray<TrackerState>>;
}

const pageKey = (projectId: TrackerProjectId, page: Page | undefined): string =>
  JSON.stringify([projectId, page?.first ?? null, page?.after ?? null]);

export class TrackerReads {
  readonly #connections = new Map<TrackerConnectionId, ConnectionReads>();
  readonly #timing: TrackerReadTiming;

  constructor(timing: Partial<TrackerReadTiming> = {}) {
    this.#timing = {
      now: timing.now ?? Date.now,
      freshMs: timing.freshMs ?? TRACKER_READ_FRESH_MS,
      maxAgeMs: timing.maxAgeMs ?? TRACKER_READ_MAX_AGE_MS,
    };
  }

  wrap(db: Database, connection: TrackerConnectionId, tracker: Tracker): Tracker {
    const reads = this.#readsOf(connection);
    const generation = () => trackerReadGeneration(db, connection);
    return {
      kind: tracker.kind,
      checkConnection: () => tracker.checkConnection(),
      verifyWebhook: (input) => tracker.verifyWebhook(input),
      getTicket: (key) => tracker.getTicket(key),
      listProjectTickets: (projectId, page) =>
        reads.tickets.read(pageKey(projectId, page), generation(), () =>
          tracker.listProjectTickets(projectId, page),
        ),
      listLabeledTickets: (input) => tracker.listLabeledTickets(input),
      listComments: (key, page) => tracker.listComments(key, page),
      listProjects: () => reads.projects.read("", generation(), () => tracker.listProjects()),
      listLabels: (projectId) =>
        reads.labels.read(projectId, generation(), () => tracker.listLabels(projectId)),
      createLabel: (input) => tracker.createLabel(input),
      listStates: (projectId) =>
        reads.states.read(projectId, generation(), () => tracker.listStates(projectId)),
      setState: (key, stateId) => tracker.setState(key, stateId),
      addComment: (key, body) => tracker.addComment(key, body),
    };
  }

  entryCount(): number {
    let count = 0;
    for (const reads of this.#connections.values())
      count += reads.tickets.size + reads.projects.size + reads.labels.size + reads.states.size;
    return count;
  }

  #readsOf(connection: TrackerConnectionId): ConnectionReads {
    let reads = this.#connections.get(connection);
    if (reads === undefined) {
      reads = {
        tickets: new StaleWhileRevalidate(this.#timing),
        projects: new StaleWhileRevalidate(this.#timing),
        labels: new StaleWhileRevalidate(this.#timing),
        states: new StaleWhileRevalidate(this.#timing),
      };
      this.#connections.set(connection, reads);
    }
    return reads;
  }
}
