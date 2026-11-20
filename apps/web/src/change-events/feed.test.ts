import { toAgentRef, toWorktreeRef } from "@ganger/core";
import type { RunId } from "@ganger/core";
import {
  CHANGE_EVENTS_KEEP_MS,
  changeRunState,
  latestChangeSeq,
  listChangesAfter,
  listRuns,
  markTrackerChanged,
  recordSettingsChange,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startChangePruning } from "../server/database";
import { changeSourceOf } from "../server/change-events";
import { connection, seedDatabase } from "../testing/seed";
import { ChangeFeed, changeStream } from "./feed";
import type { ChangeSource } from "./feed";

interface Message {
  event: string | null;
  id: string | null;
  data: unknown;
}

function parseData(text: string): unknown {
  const value: unknown = JSON.parse(text);
  return value;
}

function parse(text: string): Message[] {
  return text
    .split("\n\n")
    .filter((block) => block.includes("data: "))
    .map((block) => {
      const fields = new Map(
        block.split("\n").map((line) => {
          const at = line.indexOf(": ");
          return [line.slice(0, at), line.slice(at + 2)] as const;
        }),
      );
      return {
        event: fields.get("event") ?? null,
        id: fields.get("id") ?? null,
        data: parseData(fields.get("data") ?? "null"),
      };
    });
}

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function open(
  db: Database,
  after: number | null,
  feed = new ChangeFeed(changeSourceOf(db), { pollMs: 10 }),
) {
  const reader = changeStream({
    after,
    feed,
    source: changeSourceOf(db),
    heartbeatMs: 25,
  }).getReader();
  cleanups.push(() => reader.cancel());
  const decoder = new TextDecoder();
  let text = "";
  return {
    feed,
    async until(predicate: (messages: Message[]) => boolean): Promise<Message[]> {
      while (!predicate(parse(text))) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
      return parse(text);
    },
  };
}

const ready = (messages: Message[]) => messages.some((m) => m.event === "ready");

function queuedRun(db: Database): RunId {
  const queued = listRuns(db, { states: ["queued"] }).find((run) => run.runnerId !== null);
  if (queued === undefined) throw new Error("no queued run with a runner");
  return queued.id;
}

describe("변경 기록 SSE 통로(스펙 0003 5.3)", () => {
  it("Last-Event-ID 뒤의 줄부터 보내고, 다 보낸 뒤 지금 번호를 ready로 보낸다", async () => {
    const { db } = seedDatabase();
    const before = latestChangeSeq(db);
    recordSettingsChange(db);
    markTrackerChanged(db, connection);

    const messages = await open(db, before).until(ready);

    expect(messages.map((m) => [m.event, m.id])).toEqual([
      ["change", String(before + 1)],
      ["change", String(before + 2)],
      ["ready", String(before + 2)],
    ]);
    expect(messages[0]?.data).toEqual({
      kind: "settings",
      targetId: null,
      workspaceId: null,
      part: null,
    });
    expect(messages[1]?.data).toEqual({
      kind: "tracker",
      targetId: connection,
      workspaceId: null,
      part: null,
    });
  });

  it("연결한 뒤 쓴 줄을 1초 읽기로 이어 보내고, 하트비트를 보낸다", async () => {
    const { db } = seedDatabase();
    const stream = open(db, latestChangeSeq(db));
    await stream.until(ready);
    const runId = queuedRun(db);

    changeRunState(db, runId, {
      to: "running",
      started: {
        worktree: toWorktreeRef("repo::/wt/9"),
        branch: "acme/9",
        agentRef: toAgentRef("agent-9"),
      },
    });

    const messages = await stream.until(
      (all) => all.some((m) => m.event === "change") && all.some((m) => m.event === "heartbeat"),
    );
    expect(messages.find((m) => m.event === "change")?.data).toMatchObject({
      kind: "run",
      targetId: runId,
    });
  });

  it("이어 받을 줄을 읽은 바로 뒤 다른 프로세스가 쓴 줄도 빠뜨리지 않는다", async () => {
    const { db } = seedDatabase();
    const source = changeSourceOf(db);
    let written = false;
    const racing: ChangeSource = {
      ...source,
      after: (seq, limit) => {
        const page = source.after(seq, limit);
        if (!written) {
          written = true;
          recordSettingsChange(db);
        }
        return page;
      },
    };
    const feed = new ChangeFeed(racing, { pollMs: 10 });
    const reader = changeStream({ after: latestChangeSeq(db), feed, source: racing }).getReader();
    cleanups.push(() => reader.cancel());
    const decoder = new TextDecoder();
    let text = "";
    while (!parse(text).some((m) => m.event === "change")) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    expect(parse(text).find((m) => m.event === "change")?.data).toMatchObject({ kind: "settings" });
  });

  it("지운 번호보다 앞이면 reset을 보낸다(표가 빈 경우 포함)", async () => {
    const { db } = seedDatabase();
    const old = latestChangeSeq(db);
    startChangePruning(db, { now: () => new Date(Date.now() + 2 * CHANGE_EVENTS_KEEP_MS) })();
    expect(listChangesAfter(db, 0)).toEqual([]);

    const messages = await open(db, old - 1).until(ready);

    expect(messages.map((m) => [m.event, m.id])).toEqual([
      ["reset", String(old)],
      ["ready", String(old)],
    ]);
  });

  it("표가 비어도 지금 번호로 연결하면 reset 없이 ready만 보낸다", async () => {
    const { db } = seedDatabase();
    const latest = latestChangeSeq(db);
    startChangePruning(db, { now: () => new Date(Date.now() + 2 * CHANGE_EVENTS_KEEP_MS) })();

    const messages = await open(db, latest).until(ready);

    expect(messages.map((m) => m.event)).toEqual(["ready"]);
  });

  it("지금보다 큰 번호(DB를 되돌림)면 reset을 보낸다", async () => {
    const { db } = seedDatabase();
    const latest = latestChangeSeq(db);

    const messages = await open(db, latest + 50).until(ready);

    expect(messages.map((m) => [m.event, m.id])).toEqual([
      ["reset", String(latest)],
      ["ready", String(latest)],
    ]);
  });

  it("연결 여럿이 읽기 하나를 나눠 쓰고, 모두 닫히면 읽기를 멈춘다", async () => {
    const { db } = seedDatabase();
    const feed = new ChangeFeed(changeSourceOf(db), { pollMs: 10 });
    const first = open(db, latestChangeSeq(db), feed);
    const second = open(db, latestChangeSeq(db), feed);
    await first.until(ready);
    await second.until(ready);
    expect(feed.listenerCount).toBe(2);

    recordSettingsChange(db);
    const hasChange = (all: Message[]) => all.some((m) => m.event === "change");
    await first.until(hasChange);
    await second.until(hasChange);

    for (const cleanup of cleanups.splice(0)) await cleanup();
    expect(feed.listenerCount).toBe(0);
  });
});

describe("하루 지난 줄 지우기", () => {
  it("시작할 때 한 번 지우고, 열린 연결이 없어도 정한 주기마다 다시 지운다", () => {
    vi.useFakeTimers();
    cleanups.push(() => {
      vi.useRealTimers();
    });
    let now = new Date();
    const { db } = seedDatabase({ origin: now });
    cleanups.push(startChangePruning(db, { intervalMs: 60_000, now: () => now }));
    expect(listChangesAfter(db, 0).length).toBeGreaterThan(0);

    now = new Date(now.getTime() + 2 * CHANGE_EVENTS_KEEP_MS);
    vi.advanceTimersByTime(60_000);
    expect(listChangesAfter(db, 0)).toEqual([]);
  });
});
