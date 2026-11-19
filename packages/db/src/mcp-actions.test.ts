import { toRunnerId, toTicketKey } from "@ganger/core";
import { describe, expect, it } from "vitest";
import { listRecentMcpActions, listRunMcpActions, recordMcpAction } from "./mcp-actions.js";
import { assignRun } from "./runs.js";
import {
  getMcpWriteAllowed,
  listRunners,
  saveMcpWriteAllowed,
  saveRunnerCapacity,
} from "./settings.js";
import {
  addRunner,
  agent,
  connection,
  repoA,
  seededDatabase,
  trackerProject,
} from "./test-fixtures.js";

const at = (minute: number) => new Date(Date.UTC(2026, 10, 19, 9, minute));

function queuedRun(db: ReturnType<typeof seededDatabase>) {
  const result = assignRun(db, {
    ticket: { connection, key: toTicketKey("ENG-1") },
    trackerProject,
    runnerProject: repoA,
    agent,
    now: at(0),
  });
  if (!result.ok) throw new Error(result.reason);
  return result.run.id;
}

describe("MCP 쓰기 허용", () => {
  it("처음엔 꺼져 있고, 켜고 끈 값을 그대로 돌려준다", () => {
    const db = seededDatabase();
    expect(getMcpWriteAllowed(db)).toBe(false);
    saveMcpWriteAllowed(db, true, at(1));
    expect(getMcpWriteAllowed(db)).toBe(true);
    saveMcpWriteAllowed(db, false, at(2));
    expect(getMcpWriteAllowed(db)).toBe(false);
  });
});

describe("MCP 작업 기록", () => {
  it("런에 대한 작업은 그 런의 기록에, 나머지는 최근 작업에 시각 역순으로 남는다", () => {
    const db = seededDatabase();
    const runId = queuedRun(db);
    const base = { client: "hermes", target: null, reason: null } as const;
    recordMcpAction(db, { ...base, at: at(1), tool: "cancel_run", runId, outcome: "done" });
    recordMcpAction(db, {
      ...base,
      at: at(2),
      tool: "set_runner_capacity",
      target: "mac-mini",
      runId: null,
      outcome: "done",
    });
    recordMcpAction(db, {
      ...base,
      at: at(3),
      tool: "request_runner_check",
      runId: null,
      outcome: "rejected",
      reason: "not-found",
    });

    expect(listRunMcpActions(db, runId).map((a) => a.tool)).toEqual(["cancel_run"]);
    expect(listRecentMcpActions(db, 10).map((a) => [a.tool, a.outcome, a.target])).toEqual([
      ["request_runner_check", "rejected", null],
      ["set_runner_capacity", "done", "mac-mini"],
    ]);
    expect(listRecentMcpActions(db, 1)).toHaveLength(1);
  });

  it("런을 지우면 그 런의 작업 기록도 지운다", () => {
    const db = seededDatabase();
    const runId = queuedRun(db);
    recordMcpAction(db, {
      at: at(1),
      client: "hermes",
      tool: "cancel_run",
      target: null,
      runId,
      outcome: "done",
      reason: null,
    });
    db.$client.prepare("DELETE FROM runs WHERE id = ?").run(runId);
    expect(listRunMcpActions(db, runId)).toEqual([]);
  });
});

describe("러너 Capacity만 바꾸기", () => {
  it("ssh 대상·Orca 경로 같은 설정은 두고 Capacity만 바꾼다", () => {
    const db = seededDatabase();
    const id = addRunner(db, { id: "r1", capacity: 1, online: true, projects: [repoA] });
    const before = listRunners(db).find((r) => r.id === id);
    expect(saveRunnerCapacity(db, id, 3)).toBe(true);
    const after = listRunners(db).find((r) => r.id === id);
    expect(after).toEqual({ ...before, capacity: 3 });
  });

  it("없는 러너면 아무것도 바꾸지 않았다고 알린다", () => {
    const db = seededDatabase();
    expect(saveRunnerCapacity(db, toRunnerId("missing"), 2)).toBe(false);
  });
});
