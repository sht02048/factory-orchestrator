import type { NotificationRecord } from "@ganger/app/notifications/feed";
import { allows, isSilentKind, isTodoKind, remindsKind } from "./notification-prefs.js";
import type { NotificationPrefs } from "./notification-prefs.js";

export const BUNDLE_WINDOW_MS = 5_000;
export const BUNDLE_AFTER = 3;
export const REMIND_AFTER_MS = 10 * 60 * 1000;
export const TODO_VIEW_PATH = "/?ws=all&view=todo";

export type NotificationContent =
  | { kind: "event"; record: NotificationRecord; reminder: boolean }
  | { kind: "bundle"; count: number }
  | { kind: "missed"; count: number };

export type NotifierEffect =
  | { type: "show"; id: string; content: NotificationContent; silent: boolean; path: string }
  | { type: "remove"; ids: string[] }
  | { type: "badge"; count: number }
  | { type: "seen"; lastId: number };

export type CatchUp = "catch-up" | "live";

export interface NotifierBatch {
  events: ReadonlyArray<NotificationRecord>;
  open: ReadonlyArray<number> | null;
  cursor?: number;
  initial: boolean;
}

export interface NotifierOptions {
  prefs: () => NotificationPrefs;
  lastSeen: number | null;
}

interface Group {
  id: string;
  kind: "bundle" | "missed";
  members: Set<number>;
}

export function pathOf(record: NotificationRecord): string {
  const { target } = record;
  if (target.kind === "runner") return `/runners?sel=${encodeURIComponent(target.runnerId)}`;
  const search = new URLSearchParams({ ws: target.workspaceId, run: target.runId });
  return `/?${search.toString()}`;
}

export function eventNotificationId(id: number): string {
  return `event-${id}`;
}

export class Notifier {
  private readonly prefs: () => NotificationPrefs;
  private lastSeen: number | null;
  private readonly open = new Map<number, NotificationRecord>();
  private readonly shown = new Set<number>();
  private readonly groups = new Map<string, Group>();
  private readonly groupOfEvent = new Map<number, string>();
  private readonly reminders = new Map<number, number>();
  private window: { startedAt: number; ids: number[]; group: Group | null } | null = null;
  private groupCounter = 0;
  private badge: number | null = null;

  constructor(options: NotifierOptions) {
    this.prefs = options.prefs;
    this.lastSeen = options.lastSeen;
  }

  receive(batch: NotifierBatch, mode: CatchUp, now: number): NotifierEffect[] {
    const effects: NotifierEffect[] = [];
    if (batch.initial && batch.cursor !== undefined && this.lastSeen !== null) {
      if (batch.cursor < this.lastSeen) this.lastSeen = 0;
    }
    if (batch.open !== null) {
      const stillOpen = new Set(batch.open);
      for (const id of this.open.keys()) {
        if (!stillOpen.has(id)) this.resolve(id, effects);
      }
    }
    const fresh: NotificationRecord[] = [];
    let highest = this.lastSeen;
    for (const record of batch.events) {
      if (record.resolvedAt !== null) {
        this.resolve(record.id, effects);
      } else {
        const known = this.open.has(record.id);
        this.open.set(record.id, record);
        if (!known) this.scheduleReminder(record, now);
        if (!known && this.lastSeen !== null && record.id > this.lastSeen) fresh.push(record);
      }
      highest = Math.max(highest ?? 0, record.id);
    }
    if (this.lastSeen === null && batch.initial) highest ??= 0;
    if (batch.initial && mode === "catch-up") this.summarizeMissed(fresh, effects);
    else for (const record of fresh) this.deliver(record, now, effects);
    if (highest !== null && highest !== this.lastSeen) {
      this.lastSeen = highest;
      effects.push({ type: "seen", lastId: highest });
    }
    this.updateBadge(effects);
    return effects;
  }

  tick(now: number): NotifierEffect[] {
    const effects: NotifierEffect[] = [];
    for (const [id, due] of this.reminders) {
      if (due > now) continue;
      this.reminders.delete(id);
      const record = this.open.get(id);
      if (record === undefined || !allows(this.prefs(), record.kind)) continue;
      this.showEvent(record, true, effects);
    }
    return effects;
  }

  refresh(): NotifierEffect[] {
    const effects: NotifierEffect[] = [];
    this.updateBadge(effects);
    return effects;
  }

  clear(): NotifierEffect[] {
    const ids = [...[...this.shown].map(eventNotificationId), ...this.groups.keys()];
    this.shown.clear();
    this.groups.clear();
    this.groupOfEvent.clear();
    this.reminders.clear();
    this.open.clear();
    this.window = null;
    this.badge = 0;
    return [
      ...(ids.length === 0 ? [] : [{ type: "remove" as const, ids }]),
      { type: "badge", count: 0 },
    ];
  }

  private summarizeMissed(
    fresh: ReadonlyArray<NotificationRecord>,
    effects: NotifierEffect[],
  ): void {
    const missed = fresh.filter(
      (record) => isTodoKind(record.kind) && allows(this.prefs(), record.kind),
    );
    if (missed.length === 0) return;
    const group = this.newGroup("missed", missed);
    effects.push({
      type: "show",
      id: group.id,
      content: { kind: "missed", count: missed.length },
      silent: missed.every((record) => isSilentKind(record.kind)),
      path: TODO_VIEW_PATH,
    });
  }

  private deliver(record: NotificationRecord, now: number, effects: NotifierEffect[]): void {
    if (!allows(this.prefs(), record.kind)) return;
    if (!isTodoKind(record.kind)) {
      this.showEvent(record, false, effects);
      return;
    }
    if (this.window === null || now - this.window.startedAt > BUNDLE_WINDOW_MS) {
      this.window = { startedAt: now, ids: [], group: null };
    }
    const window = this.window;
    window.ids.push(record.id);
    if (window.ids.length <= BUNDLE_AFTER) {
      this.showEvent(record, false, effects);
      return;
    }
    const members = window.ids.flatMap((id) => {
      const member = this.open.get(id);
      return member === undefined ? [] : [member];
    });
    const earlier = members.filter((member) => this.shown.has(member.id));
    if (earlier.length > 0) {
      for (const member of earlier) this.shown.delete(member.id);
      effects.push({
        type: "remove",
        ids: earlier.map((member) => eventNotificationId(member.id)),
      });
    }
    window.group ??= this.newGroup("bundle", []);
    const group = window.group;
    for (const member of members) {
      group.members.add(member.id);
      this.groupOfEvent.set(member.id, group.id);
    }
    effects.push({
      type: "show",
      id: group.id,
      content: { kind: "bundle", count: window.ids.length },
      silent: members.every((member) => isSilentKind(member.kind)),
      path: TODO_VIEW_PATH,
    });
  }

  private scheduleReminder(record: NotificationRecord, now: number): void {
    if (!remindsKind(record.kind)) return;
    const due = Date.parse(record.createdAt) + REMIND_AFTER_MS;
    if (due > now) this.reminders.set(record.id, due);
  }

  private newGroup(kind: Group["kind"], members: ReadonlyArray<NotificationRecord>): Group {
    this.groupCounter += 1;
    const group: Group = {
      id: `${kind}-${this.groupCounter}`,
      kind,
      members: new Set(members.map((member) => member.id)),
    };
    this.groups.set(group.id, group);
    for (const member of members) this.groupOfEvent.set(member.id, group.id);
    return group;
  }

  private showEvent(
    record: NotificationRecord,
    reminder: boolean,
    effects: NotifierEffect[],
  ): void {
    this.shown.add(record.id);
    effects.push({
      type: "show",
      id: eventNotificationId(record.id),
      content: { kind: "event", record, reminder },
      silent: isSilentKind(record.kind),
      path: pathOf(record),
    });
  }

  private resolve(id: number, effects: NotifierEffect[]): void {
    this.open.delete(id);
    this.reminders.delete(id);
    const removed: string[] = [];
    if (this.shown.delete(id)) removed.push(eventNotificationId(id));
    const groupId = this.groupOfEvent.get(id);
    if (groupId !== undefined) {
      this.groupOfEvent.delete(id);
      const group = this.groups.get(groupId);
      group?.members.delete(id);
      if (group !== undefined && group.members.size === 0) {
        this.groups.delete(groupId);
        if (this.window?.group === group) this.window.group = null;
        removed.push(groupId);
      }
    }
    if (removed.length > 0) effects.push({ type: "remove", ids: removed });
  }

  private updateBadge(effects: NotifierEffect[]): void {
    const count = this.prefs().enabled
      ? [...this.open.values()].filter((record) => isTodoKind(record.kind)).length
      : 0;
    if (count === this.badge) return;
    this.badge = count;
    effects.push({ type: "badge", count });
  }
}
