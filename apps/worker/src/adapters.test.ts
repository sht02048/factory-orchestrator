import {
  AdapterError,
  AdapterRegistry,
  toCodeHostKind,
  toPullRequestId,
  toRepoRef,
  toRunnerId,
  toRunnerKind,
  toTicketKey,
  toTrackerConnectionId,
  toTrackerKind,
} from "@factory/core";
import type { CodeHost, Runner, Tracker } from "@factory/core";
import { FakeCodeHost, FakeRunner, FakeTracker } from "@factory/core/testing";
import {
  SecretBox,
  listRunners,
  migrate,
  openDatabase,
  saveCodeHostConnection,
  saveRunner,
  saveTrackerConnection,
  toCodeHostConnectionId,
} from "@factory/db";
import type { Database } from "@factory/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ConnectionPausedError,
  MAX_PAUSE_MS,
  RATE_LIMIT_PAUSE_MS,
  UNAUTHORIZED_PAUSE_MS,
  WorkerAdapters,
} from "./adapters.js";

const kind = "fake";
const trackerId = toTrackerConnectionId("conn-1");
const codeHostId = toCodeHostConnectionId("code-1");
const runnerId = toRunnerId("runner-1");
const ticket = toTicketKey("ENG-1");

class CountingFactories {
  readonly trackers: Array<{ config: unknown; adapter: FakeTracker }> = [];
  readonly codeHosts: Array<{ config: unknown; adapter: FakeCodeHost }> = [];
  readonly runners: Array<{ config: unknown; adapter: FakeRunner }> = [];
  readonly registry = new AdapterRegistry()
    .registerTracker({
      kind: toTrackerKind(kind),
      create: (config): Tracker => {
        const adapter = new FakeTracker(toTrackerKind(kind));
        this.trackers.push({ config, adapter });
        return adapter;
      },
    })
    .registerCodeHost({
      kind: toCodeHostKind(kind),
      create: (config): CodeHost => {
        const adapter = new FakeCodeHost(toCodeHostKind(kind));
        this.codeHosts.push({ config, adapter });
        return adapter;
      },
    })
    .registerRunner({
      kind: toRunnerKind(kind),
      create: (config): Runner => {
        const adapter = new FakeRunner(toRunnerKind(kind));
        this.runners.push({ config, adapter });
        return adapter;
      },
    });
}

let db: Database;
let box: SecretBox;
let factories: CountingFactories;
let now: Date;
let adapters: WorkerAdapters;

function saveTracker(apiKey: string, config: unknown = {}): void {
  saveTrackerConnection(db, box, {
    id: trackerId,
    kind: toTrackerKind(kind),
    name: "Acme",
    config,
    secrets: { apiKey },
  });
}

function saveCodeHost(token: string): void {
  saveCodeHostConnection(db, box, {
    id: codeHostId,
    kind: toCodeHostKind(kind),
    name: "Acme",
    config: {},
    secrets: { token },
  });
}

function saveFakeRunner(config: unknown): void {
  saveRunner(db, { id: runnerId, kind: toRunnerKind(kind), name: "r", config, capacity: 1 });
}

function storedRunner() {
  const runner = listRunners(db).find((r) => r.id === runnerId);
  if (runner === undefined) throw new Error("runner not saved");
  return runner;
}

function tracker(): Tracker {
  const adapter = adapters.tracker(db, trackerId);
  if (adapter === null) throw new Error("tracker connection not saved");
  return adapter;
}

function codeHosts(): CodeHost[] {
  return adapters.allCodeHosts(db, (_id, error) => {
    throw error;
  });
}

function latestTracker(): FakeTracker {
  const last = factories.trackers.at(-1);
  if (last === undefined) throw new Error("no tracker created");
  return last.adapter;
}

function advance(ms: number): void {
  now = new Date(now.getTime() + ms);
}

beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db);
  box = new SecretBox(new Uint8Array(32).fill(3));
  factories = new CountingFactories();
  now = new Date("2026-11-18T00:00:00Z");
  adapters = new WorkerAdapters(factories.registry, box, () => now);
});

afterEach(() => {
  db.$client.close();
});

describe("WorkerAdapters: 설정이 바뀌면 어댑터를 다시 만든다", () => {
  it("트래커 연결: 설정이 그대로면 다시 쓰고, 토큰이나 설정이 바뀌면 새로 만든다", () => {
    saveTracker("key-1");
    const first = tracker();
    expect(tracker()).toBe(first);
    expect(factories.trackers).toHaveLength(1);
    expect(factories.trackers[0]?.config).toEqual({ config: {}, secrets: { apiKey: "key-1" } });

    saveTracker("key-2");
    const second = tracker();
    expect(second).not.toBe(first);
    expect(factories.trackers).toHaveLength(2);
    expect(factories.trackers[1]?.config).toEqual({ config: {}, secrets: { apiKey: "key-2" } });

    saveTracker("key-2", { teamId: "t-1" });
    expect(tracker()).not.toBe(second);
    expect(factories.trackers).toHaveLength(3);
  });

  it("코드 호스트 연결: 토큰이 바뀌면 새로 만든다", () => {
    saveCodeHost("token-1");
    const [first] = codeHosts();
    expect(codeHosts()[0]).toBe(first);
    expect(factories.codeHosts).toHaveLength(1);

    saveCodeHost("token-2");
    expect(codeHosts()[0]).not.toBe(first);
    expect(factories.codeHosts).toHaveLength(2);
    expect(factories.codeHosts[1]?.config).toEqual({ config: {}, secrets: { token: "token-2" } });
  });

  it("러너: 러너 설정이 바뀌면 새로 만든다", () => {
    saveFakeRunner({ sshTarget: "runner-a" });
    const first = adapters.runner(storedRunner());
    expect(adapters.runner(storedRunner())).toBe(first);

    saveFakeRunner({ sshTarget: "runner-b" });
    const second = adapters.runner(storedRunner());
    expect(second).not.toBe(first);
    expect(factories.runners.map((r) => r.config)).toEqual([
      { sshTarget: "runner-a" },
      { sshTarget: "runner-b" },
    ]);
  });
});

describe("WorkerAdapters: 오류 종류에 맞춰 연결을 쉰다", () => {
  function failNextGetTicket(error: unknown): void {
    const fake = latestTracker();
    const original = fake.getTicket.bind(fake);
    let failed = false;
    fake.getTicket = (key) => {
      if (failed) return original(key);
      failed = true;
      return Promise.reject(error);
    };
  }

  it("트래커 rate limit은 Retry-After 동안 요청을 보내지 않는다", async () => {
    saveTracker("key-1");
    tracker();
    failNextGetTicket(new AdapterError({ kind: "rate-limited", retryAfterSeconds: 30 }));
    await expect(tracker().getTicket(ticket)).rejects.toMatchObject({
      detail: { kind: "rate-limited" },
    });

    advance(29_000);
    await expect(tracker().getTicket(ticket)).rejects.toBeInstanceOf(ConnectionPausedError);
    advance(1_000);
    await expect(tracker().getTicket(ticket)).resolves.toBeNull();
  });

  it("다시 해 볼 시각을 모르는 rate limit은 기본 시간만큼 쉰다", async () => {
    saveTracker("key-1");
    tracker();
    failNextGetTicket(new AdapterError({ kind: "rate-limited", retryAfterSeconds: null }));
    await expect(tracker().getTicket(ticket)).rejects.toBeInstanceOf(AdapterError);

    advance(RATE_LIMIT_PAUSE_MS - 1);
    await expect(tracker().listProjects()).rejects.toBeInstanceOf(ConnectionPausedError);
    advance(1);
    await expect(tracker().listProjects()).resolves.toEqual([]);
  });

  it("인증 실패는 길게 쉬지만, 토큰을 바꾸면 새 어댑터로 바로 다시 한다", async () => {
    saveTracker("bad-key");
    tracker();
    failNextGetTicket(new AdapterError({ kind: "unauthorized" }));
    await expect(tracker().getTicket(ticket)).rejects.toMatchObject({
      detail: { kind: "unauthorized" },
    });
    advance(UNAUTHORIZED_PAUSE_MS - 1);
    await expect(tracker().getTicket(ticket)).rejects.toBeInstanceOf(ConnectionPausedError);

    saveTracker("good-key");
    await expect(tracker().getTicket(ticket)).resolves.toBeNull();
  });

  it("없는 대상·네트워크 오류는 쉬지 않는다", async () => {
    saveTracker("key-1");
    tracker();
    failNextGetTicket(new AdapterError({ kind: "network", cause: "reset" }));
    await expect(tracker().getTicket(ticket)).rejects.toMatchObject({
      detail: { kind: "network" },
    });
    await expect(tracker().getTicket(ticket)).resolves.toBeNull();
  });

  it("코드 호스트 rate limit은 resetAt까지 쉬고, 너무 먼 시각은 상한까지만 쉰다", async () => {
    saveCodeHost("token-1");
    const [codeHost] = codeHosts();
    const inner = factories.codeHosts[0]?.adapter;
    if (codeHost === undefined || inner === undefined) throw new Error("code host not created");
    const repo = toRepoRef("acme/web");
    inner.findPullRequestsByBranch = () =>
      Promise.reject(
        new AdapterError({
          kind: "rate-limited",
          resetAt: new Date(now.getTime() + 10 * 3_600_000),
        }),
      );
    await expect(codeHost.findPullRequestsByBranch(repo, "b")).rejects.toMatchObject({
      detail: { kind: "rate-limited" },
    });
    advance(MAX_PAUSE_MS - 1);
    await expect(codeHost.getPullRequest(repo, toPullRequestId("pr-1"))).rejects.toBeInstanceOf(
      ConnectionPausedError,
    );
    advance(1);
    await expect(
      codeHost.findPullRequestsByTicketKey(repo, ticket, { createdSince: now }),
    ).resolves.toEqual([]);
  });

  it("코드 호스트의 인증 실패는 저장소 하나의 권한 문제일 수 있어 쉬지 않는다", async () => {
    saveCodeHost("token-1");
    const [codeHost] = codeHosts();
    const inner = factories.codeHosts[0]?.adapter;
    if (codeHost === undefined || inner === undefined) throw new Error("code host not created");
    const forbidden = toRepoRef("acme/private");
    const open = toRepoRef("acme/web");
    const original = inner.findPullRequestsByBranch.bind(inner);
    inner.findPullRequestsByBranch = (repo, branch) =>
      repo === forbidden
        ? Promise.reject(new AdapterError({ kind: "unauthorized" }))
        : original(repo, branch);
    await expect(codeHost.findPullRequestsByBranch(forbidden, "b")).rejects.toMatchObject({
      detail: { kind: "unauthorized" },
    });
    await expect(codeHost.findPullRequestsByBranch(open, "b")).resolves.toEqual([]);
  });
});
