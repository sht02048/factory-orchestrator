import { toTicketKey } from "@ganger/core";
import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_REOPEN_WINDOW_MS,
  RESOLVED_NOTIFICATION_KEEP_MS,
  listNotificationChanges,
  listOpenNotificationEvents,
  notificationCursor,
  syncNotificationEvents,
} from "./notification-events.js";
import type { NotificationCause } from "./notification-events.js";
import { assignRun } from "./runs.js";
import {
  addRunner,
  agent,
  connection,
  repoA,
  seededDatabase,
  trackerProject,
  workspaceId,
} from "./test-fixtures.js";

const start = new Date(Date.UTC(2026, 10, 19, 9, 0));
const after = (ms: number) => new Date(start.getTime() + ms);
const MINUTE = 60_000;

function setup() {
  const db = seededDatabase();
  const runnerId = addRunner(db, { id: "runner-a", capacity: 1, online: false, projects: [repoA] });
  const assigned = assignRun(db, {
    ticket: { connection, key: toTicketKey("ACME-1") },
    trackerProject,
    runnerProject: repoA,
    agent,
    now: start,
  });
  if (!assigned.ok) throw new Error(assigned.reason);
  const runId = assigned.run.id;
  const offline: NotificationCause = {
    kind: "runner-offline",
    cause: `runner-offline:${runnerId}`,
    target: { kind: "runner", runnerId },
    subject: "runner-a",
    detail: null,
  };
  const question: NotificationCause = {
    kind: "question",
    cause: "question:q-1",
    target: { kind: "run", runId, workspaceId, ticketKey: toTicketKey("ACME-1") },
    subject: "ACME-1",
    detail: null,
  };
  return { db, runnerId, runId, offline, question };
}

describe("알림 사건 저장소", () => {
  it("같은 원인은 해결 전이면 사건 하나로 둔다", () => {
    const { db, offline } = setup();
    syncNotificationEvents(db, [offline], start);
    syncNotificationEvents(db, [offline, offline], after(MINUTE));
    syncNotificationEvents(db, [offline], after(2 * MINUTE));
    const open = listOpenNotificationEvents(db);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      kind: "runner-offline",
      subject: "runner-a",
      createdAt: start,
      resolvedAt: null,
    });
  });

  it("원인이 사라지면 해결 시각을 남기고, 다른 원인은 새 사건이 된다", () => {
    const { db, offline, question } = setup();
    syncNotificationEvents(db, [offline, question], start);
    const result = syncNotificationEvents(db, [offline], after(MINUTE));
    expect(result).toMatchObject({ opened: 0, resolved: 1 });
    const changes = listNotificationChanges(db, 0);
    const resolved = changes.find((event) => event.kind === "question");
    expect(resolved?.resolvedAt).toEqual(after(MINUTE));
    expect(listOpenNotificationEvents(db).map((event) => event.kind)).toEqual(["runner-offline"]);
  });

  it("해결된 뒤 곧 다시 생긴 같은 원인은 새 사건 대신 그 사건을 다시 연다", () => {
    const { db, offline } = setup();
    syncNotificationEvents(db, [offline], start);
    const [first] = listOpenNotificationEvents(db);
    syncNotificationEvents(db, [], after(MINUTE));
    const result = syncNotificationEvents(db, [offline], after(2 * MINUTE));
    expect(result).toMatchObject({ opened: 0, reopened: 1 });
    const open = listOpenNotificationEvents(db);
    expect(open.map((event) => event.id)).toEqual([first?.id]);
    expect(open[0]?.createdAt).toEqual(start);
  });

  it("해결된 지 오래 지나 다시 생긴 원인은 새 사건이다", () => {
    const { db, offline } = setup();
    syncNotificationEvents(db, [offline], start);
    const [first] = listOpenNotificationEvents(db);
    syncNotificationEvents(db, [], after(MINUTE));
    syncNotificationEvents(db, [offline], after(MINUTE + NOTIFICATION_REOPEN_WINDOW_MS + 1));
    const open = listOpenNotificationEvents(db);
    expect(open).toHaveLength(1);
    expect(open[0]?.id).toBeGreaterThan(first?.id ?? 0);
  });

  it("번호는 만들고 해결할 때마다 단조 증가하고, 그 뒤 바뀐 것만 돌려준다", () => {
    const { db, offline, question } = setup();
    expect(notificationCursor(db)).toBe(0);
    syncNotificationEvents(db, [offline], start);
    const first = notificationCursor(db);
    syncNotificationEvents(db, [offline, question], after(MINUTE));
    const second = notificationCursor(db);
    syncNotificationEvents(db, [question], after(2 * MINUTE));
    const third = notificationCursor(db);
    expect(first).toBeLessThan(second);
    expect(second).toBeLessThan(third);
    expect(listNotificationChanges(db, second).map((event) => [event.kind, event.seq])).toEqual([
      ["runner-offline", third],
    ]);
    const byId = listNotificationChanges(db, 0).toSorted((a, b) => a.id - b.id);
    expect(byId.map((event) => event.kind)).toEqual(["runner-offline", "question"]);
  });

  it("해결된 사건은 7일 뒤 지우고, 번호는 되돌아가지 않는다", () => {
    const { db, offline } = setup();
    syncNotificationEvents(db, [offline], start);
    syncNotificationEvents(db, [], after(MINUTE));
    const cursor = notificationCursor(db);
    syncNotificationEvents(db, [], after(MINUTE + RESOLVED_NOTIFICATION_KEEP_MS - 1));
    expect(listNotificationChanges(db, 0)).toHaveLength(1);
    const result = syncNotificationEvents(
      db,
      [],
      after(MINUTE + RESOLVED_NOTIFICATION_KEEP_MS + 1),
    );
    expect(result.purged).toBe(1);
    expect(listNotificationChanges(db, 0)).toEqual([]);
    syncNotificationEvents(db, [offline], after(2 * RESOLVED_NOTIFICATION_KEEP_MS));
    expect(notificationCursor(db)).toBeGreaterThan(cursor);
    expect(listNotificationChanges(db, cursor)).toHaveLength(1);
  });

  it("해결되지 않은 사건은 7일이 지나도 지우지 않는다", () => {
    const { db, question } = setup();
    syncNotificationEvents(db, [question], start);
    syncNotificationEvents(db, [question], after(2 * RESOLVED_NOTIFICATION_KEEP_MS));
    expect(listOpenNotificationEvents(db)).toHaveLength(1);
  });
});
