import type { NotificationRecord } from "@ganger/app/notifications/feed";
import { describe, expect, it } from "vitest";
import { DEFAULT_NOTIFICATION_PREFS } from "./notification-prefs.js";
import type { NotificationPrefs } from "./notification-prefs.js";
import { BUNDLE_WINDOW_MS, Notifier, REMIND_AFTER_MS, TODO_VIEW_PATH, pathOf } from "./notifier.js";
import type { NotifierEffect } from "./notifier.js";

const T = Date.parse("2026-11-19T09:00:00.000Z");

function event(
  id: number,
  kind: NotificationRecord["kind"] = "question",
  options: { resolved?: boolean; createdAt?: number } = {},
): NotificationRecord {
  const runner = kind.startsWith("runner-");
  return {
    id,
    seq: id,
    kind,
    target: runner
      ? { kind: "runner", runnerId: `runner-${id}` }
      : { kind: "run", runId: `run-${id}`, workspaceId: "ws-1", ticketKey: `ACME-${id}` },
    subject: runner ? `runner-${id}` : `ACME-${id}`,
    detail: kind === "runner-usage-limit" ? "claude" : null,
    createdAt: new Date(options.createdAt ?? T).toISOString(),
    resolvedAt: options.resolved === true ? new Date(T + 1).toISOString() : null,
  };
}

function setup(lastSeen: number | null = 0, prefs: NotificationPrefs = DEFAULT_NOTIFICATION_PREFS) {
  let current = prefs;
  const notifier = new Notifier({ prefs: () => current, lastSeen });
  return {
    notifier,
    setPrefs: (next: NotificationPrefs) => {
      current = next;
    },
  };
}

const shows = (effects: NotifierEffect[]) =>
  effects.flatMap((effect) => (effect.type === "show" ? [effect] : []));
const removed = (effects: NotifierEffect[]) =>
  effects.flatMap((effect) => (effect.type === "remove" ? effect.ids : []));
const badge = (effects: NotifierEffect[]) =>
  effects.flatMap((effect) => (effect.type === "badge" ? [effect.count] : [])).at(-1);

function live(notifier: Notifier, records: NotificationRecord[], at = T) {
  return notifier.receive({ events: records, open: null, initial: false }, "live", at);
}

describe("알림 고르기", () => {
  it("Human Check 만 소리 없이, 나머지는 소리와 함께 알린다", () => {
    const { notifier } = setup();
    const kinds: NotificationRecord["kind"][] = [
      "question",
      "permission",
      "human-check",
      "runner-offline",
      "runner-auth",
      "runner-usage-limit",
    ];
    const effects = kinds.flatMap((kind, index) =>
      live(notifier, [event(index + 1, kind)], T + index * BUNDLE_WINDOW_MS * 2),
    );
    expect(
      shows(effects).map((show) => [
        show.content.kind === "event" && show.content.record.kind,
        show.silent,
      ]),
    ).toEqual([
      ["question", false],
      ["permission", false],
      ["human-check", true],
      ["runner-offline", false],
      ["runner-auth", false],
      ["runner-usage-limit", false],
    ]);
    const failed = live(
      notifier,
      [event(20, "failed"), event(21, "disconnected")],
      T + 100 * BUNDLE_WINDOW_MS,
    );
    expect(shows(failed).map((show) => show.silent)).toEqual([false, false]);
  });

  it("5초 안에 3건을 넘으면 앞 알림을 지우고 하나로 묶는다", () => {
    const { notifier } = setup();
    const first = live(notifier, [event(1), event(2), event(3, "human-check")], T);
    expect(shows(first).map((show) => show.id)).toEqual(["event-1", "event-2", "event-3"]);
    const fourth = live(notifier, [event(4, "human-check")], T + 4_000);
    expect(removed(fourth)).toEqual(["event-1", "event-2", "event-3"]);
    expect(shows(fourth)).toEqual([
      {
        type: "show",
        id: "bundle-1",
        content: { kind: "bundle", count: 4 },
        silent: false,
        path: TODO_VIEW_PATH,
      },
    ]);
    const fifth = live(notifier, [event(5)], T + 4_500);
    expect(shows(fifth).map((show) => [show.id, show.content])).toEqual([
      ["bundle-1", { kind: "bundle", count: 5 }],
    ]);
    const later = live(notifier, [event(6)], T + BUNDLE_WINDOW_MS + 1);
    expect(shows(later).map((show) => show.id)).toEqual(["event-6"]);
  });

  it("Runner Issue 는 묶지 않는다", () => {
    const { notifier } = setup();
    const effects = live(
      notifier,
      [1, 2, 3, 4].map((id) => event(id, "runner-offline")),
      T,
    );
    expect(shows(effects).map((show) => show.id)).toEqual([
      "event-1",
      "event-2",
      "event-3",
      "event-4",
    ]);
  });

  it("Question·Permission 이 10분 동안 해결되지 않으면 한 번만 다시 알린다", () => {
    const { notifier } = setup();
    live(notifier, [event(1, "question"), event(2, "permission"), event(3, "human-check")], T);
    expect(shows(notifier.tick(T + REMIND_AFTER_MS - 1))).toEqual([]);
    const reminded = shows(notifier.tick(T + REMIND_AFTER_MS));
    expect(
      reminded.map((show) => [show.id, show.content.kind === "event" && show.content.reminder]),
    ).toEqual([
      ["event-1", true],
      ["event-2", true],
    ]);
    expect(shows(notifier.tick(T + 3 * REMIND_AFTER_MS))).toEqual([]);
  });

  it("10분 전에 해결되면 다시 알리지 않는다", () => {
    const { notifier } = setup();
    live(notifier, [event(1)], T);
    live(notifier, [event(1, "question", { resolved: true })], T + 1_000);
    expect(shows(notifier.tick(T + REMIND_AFTER_MS))).toEqual([]);
  });

  it("다른 곳에서 해결되면 그 알림을 지우고, 묶음은 모두 해결됐을 때 지운다", () => {
    const { notifier } = setup();
    live(notifier, [event(1)], T);
    expect(removed(live(notifier, [event(1, "question", { resolved: true })], T + 10))).toEqual([
      "event-1",
    ]);
    live(
      notifier,
      [10, 11, 12, 13].map((id) => event(id)),
      T + BUNDLE_WINDOW_MS * 2,
    );
    expect(
      removed(
        live(
          notifier,
          [10, 11, 12].map((id) => event(id, "question", { resolved: true })),
        ),
      ),
    ).toEqual([]);
    expect(removed(live(notifier, [event(13, "question", { resolved: true })]))).toEqual([
      "bundle-1",
    ]);
  });

  it("다시 붙었을 때 열린 목록에 없는 사건의 알림을 지운다", () => {
    const { notifier } = setup();
    live(notifier, [event(1), event(2, "runner-offline")], T);
    const effects = notifier.receive({ events: [], open: [2], initial: true }, "live", T + 10);
    expect(removed(effects)).toEqual(["event-1"]);
  });

  it("앱을 켜거나 깼을 때 그 사이 생긴 해결 안 된 처리할 일만 알림 하나로 모은다", () => {
    const { notifier } = setup(5);
    const effects = notifier.receive(
      {
        events: [
          event(3),
          event(6),
          event(7, "failed"),
          event(8, "human-check"),
          event(9, "runner-offline"),
          event(10, "question", { resolved: true }),
        ],
        open: [3, 6, 7, 8, 9],
        initial: true,
      },
      "catch-up",
      T,
    );
    expect(shows(effects)).toEqual([
      {
        type: "show",
        id: "missed-1",
        content: { kind: "missed", count: 3 },
        silent: false,
        path: TODO_VIEW_PATH,
      },
    ]);
    expect(effects).toContainEqual({ type: "seen", lastId: 10 });
    expect(shows(notifier.tick(T + REMIND_AFTER_MS)).map((show) => show.id)).toEqual([
      "event-3",
      "event-6",
    ]);
    expect(shows(notifier.tick(T + REMIND_AFTER_MS * 2))).toEqual([]);
  });

  it("앱을 다시 켰을 때 10분이 안 된 열린 Question 은 생긴 지 10분에 다시 알리고, 지난 것은 다시 알리지 않는다", () => {
    const { notifier } = setup(5);
    notifier.receive(
      {
        events: [
          event(1, "question", { createdAt: T - REMIND_AFTER_MS - 1 }),
          event(2, "permission", { createdAt: T - 60_000 }),
        ],
        open: [1, 2],
        initial: true,
      },
      "catch-up",
      T,
    );
    expect(shows(notifier.tick(T + REMIND_AFTER_MS)).map((show) => show.id)).toEqual(["event-2"]);
  });

  it("서버 번호가 기억한 번호보다 작으면 새 서버로 보고 열린 처리할 일을 놓친 일로 모은다", () => {
    const { notifier } = setup(500);
    const effects = notifier.receive(
      { events: [event(1), event(2, "failed")], open: [1, 2], cursor: 2, initial: true },
      "catch-up",
      T,
    );
    expect(shows(effects).map((show) => show.content)).toEqual([{ kind: "missed", count: 2 }]);
    expect(effects).toContainEqual({ type: "seen", lastId: 2 });
    expect(shows(live(notifier, [event(3)], T + 1)).map((show) => show.id)).toEqual(["event-3"]);
  });

  it("처음 붙는 서버는 기준만 잡고 알리지 않는다", () => {
    const { notifier } = setup(null);
    const effects = notifier.receive(
      { events: [event(1), event(2)], open: [1, 2], initial: true },
      "catch-up",
      T,
    );
    expect(shows(effects)).toEqual([]);
    expect(effects).toContainEqual({ type: "seen", lastId: 2 });
    expect(shows(live(notifier, [event(3)], T + 1))).toHaveLength(1);
  });

  it("해결된 뒤 다시 열린 사건은 다시 울리지 않는다", () => {
    const { notifier } = setup();
    live(notifier, [event(1, "runner-offline")], T);
    live(notifier, [event(1, "runner-offline", { resolved: true })], T + 1);
    expect(shows(live(notifier, [event(1, "runner-offline")], T + 2))).toEqual([]);
  });

  it("알림 전체를 끄거나 종류를 끄면 그 종류는 알리지 않는다", () => {
    const { notifier, setPrefs } = setup();
    setPrefs({
      enabled: true,
      groups: {
        ...DEFAULT_NOTIFICATION_PREFS.groups,
        failedDisconnected: false,
        runnerIssue: false,
      },
    });
    const effects = live(
      notifier,
      [event(1, "failed"), event(2, "disconnected"), event(3, "runner-auth"), event(4)],
      T,
    );
    expect(shows(effects).map((show) => show.id)).toEqual(["event-4"]);
    setPrefs({ ...DEFAULT_NOTIFICATION_PREFS, enabled: false });
    const off = live(notifier, [event(5)], T + BUNDLE_WINDOW_MS * 2);
    expect(shows(off)).toEqual([]);
    expect(badge(off)).toBe(0);
  });

  it("Dock 배지는 열린 처리할 일 개수이고 Runner Issue 는 세지 않는다", () => {
    const { notifier } = setup();
    expect(
      badge(live(notifier, [event(1), event(2, "failed"), event(3, "runner-offline")], T)),
    ).toBe(2);
    expect(badge(live(notifier, [event(1, "question", { resolved: true })], T + 1))).toBe(1);
  });

  it("누르면 런은 Dashboard 에서 그 카드 상세를, Runner Issue 는 Runners 의 그 러너를 연다", () => {
    expect(pathOf(event(4, "question"))).toBe("/?ws=ws-1&run=run-4");
    expect(pathOf(event(5, "runner-auth"))).toBe("/runners?sel=runner-5");
    const { notifier } = setup();
    const [show] = shows(live(notifier, [event(6, "failed")], T));
    expect(show?.path).toBe("/?ws=ws-1&run=run-6");
  });
});
