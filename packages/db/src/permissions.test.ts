import { toPermissionRequestId, toTicketKey } from "@factory/core";
import type { RunId } from "@factory/core";
import { describe, expect, it } from "vitest";
import type { Database } from "./database.js";
import {
  denyPermissionWait,
  listRunPermissionWaits,
  listUnsentDenials,
  markDenialSent,
  recordPermissionWaits,
  resolvePermissionWaits,
  sentDenialIds,
} from "./permissions.js";
import { assignRun } from "./runs.js";
import { agent, connection, repoA, seededDatabase, trackerProject } from "./test-fixtures.js";

function runOf(db: Database, key: string): RunId {
  const result = assignRun(db, {
    ticket: { connection, key: toTicketKey(key) },
    trackerProject,
    runnerProject: repoA,
    agent,
    now: new Date("2026-11-17T00:00:00Z"),
  });
  if (!result.ok) throw new Error(result.reason);
  return result.run.id;
}

const p1 = toPermissionRequestId("apr-1");
const p2 = toPermissionRequestId("apr-2");
const requestedAt = new Date("2026-11-17T01:00:00Z");

describe("권한 대기와 거절 요청 (Q82.4·Q82.5)", () => {
  it("대기를 한 번만 쓰고, 거절을 남기고, 보낼 거절을 한 번만 꺼내 처리 표시를 한다", () => {
    const db = seededDatabase();
    const id = runOf(db, "ENG-1");
    const wait = { id: p1, detail: "Bash(touch a.txt)", requestedAt };

    expect(recordPermissionWaits(db, id, [wait])).toBe(1);
    // 러너는 메일을 소비하지 않아 같은 대기가 다시 온다.
    expect(recordPermissionWaits(db, id, [wait])).toBe(0);
    expect(listUnsentDenials(db)).toEqual([]);

    const deniedAt = new Date("2026-11-17T01:05:00Z");
    expect(
      denyPermissionWait(db, { runId: id, permissionId: p1, reason: "읽기만 해 주세요" }, deniedAt),
    ).toEqual({ ok: true });
    expect(denyPermissionWait(db, { runId: id, permissionId: p1, reason: "" })).toEqual({
      ok: false,
      reason: "already-denied",
    });
    expect(listUnsentDenials(db)).toEqual([
      { runId: id, permissionId: p1, reason: "읽기만 해 주세요", deniedAt },
    ]);
    expect(sentDenialIds(db, id).size).toBe(0);

    expect(markDenialSent(db, { runId: id, permissionId: p1 })).toBe(true);
    expect(markDenialSent(db, { runId: id, permissionId: p1 })).toBe(false);
    expect(listUnsentDenials(db)).toEqual([]);
    expect([...sentDenialIds(db, id)]).toEqual([p1]);
    expect(listRunPermissionWaits(db, id)).toMatchObject([
      {
        id: p1,
        detail: "Bash(touch a.txt)",
        resolvedAt: null,
        denial: { reason: "읽기만 해 주세요", deniedAt },
      },
    ]);
  });

  it("폴링에 더 이상 없는 대기를 닫고, 닫힌 대기는 거절할 수 없다", () => {
    const db = seededDatabase();
    const id = runOf(db, "ENG-1");
    recordPermissionWaits(db, id, [
      { id: p1, detail: "a", requestedAt },
      { id: p2, detail: "b", requestedAt },
    ]);
    const at = new Date("2026-11-17T02:00:00Z");
    // 러너에서 p1을 허용해 p2만 남았다
    expect(resolvePermissionWaits(db, id, [p2], at)).toBe(1);
    expect(resolvePermissionWaits(db, id, [p2], at)).toBe(0);
    expect(listRunPermissionWaits(db, id).map((w) => [w.id, w.resolvedAt])).toEqual([
      [p1, at],
      [p2, null],
    ]);
    expect(denyPermissionWait(db, { runId: id, permissionId: p1, reason: "" })).toEqual({
      ok: false,
      reason: "resolved",
    });
    // 열린 대기가 없으면 모두 닫는다
    expect(resolvePermissionWaits(db, id, [], at)).toBe(1);
  });

  it("받지 않은 대기는 거절할 수 없고, 다른 런의 대기는 닫지 않는다", () => {
    const db = seededDatabase();
    const a = runOf(db, "ENG-1");
    const b = runOf(db, "ENG-2");
    recordPermissionWaits(db, a, [{ id: p1, detail: "a", requestedAt }]);
    recordPermissionWaits(db, b, [{ id: p1, detail: "b", requestedAt }]);
    expect(denyPermissionWait(db, { runId: a, permissionId: p2, reason: "" })).toEqual({
      ok: false,
      reason: "not-found",
    });
    resolvePermissionWaits(db, a, []);
    expect(listRunPermissionWaits(db, b)[0]?.resolvedAt).toBeNull();
  });
});
