import {
  toAgentRef,
  toDeliveryId,
  toPermissionRequestId,
  toQuestionId,
  toRunId,
  toTicketKey,
  toWorktreeRef,
} from "@ganger/core";
import type { RunId, TicketKey } from "@ganger/core";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Database } from "./database.js";
import { recordTrackerEvent } from "./events.js";
import { recordMcpAction } from "./mcp-actions.js";
import { runTimeline, ticketTimeline } from "./run-timeline.js";
import { assignRun } from "./runs.js";
import {
  mcpActions,
  notificationEvents,
  runCancelRequests,
  runControlRequests,
  runPermissionWaits,
  runQuestions,
  runs,
  runStateChanges,
} from "./schema.js";
import {
  addRunner,
  agent,
  connection,
  repoA,
  seededDatabase,
  trackerProject,
  workspaceId,
} from "./test-fixtures.js";

const at = (minute: number) => new Date(Date.UTC(2026, 10, 20, 9, minute));

function queuedRun(db: Database, key: TicketKey, minute: number): RunId {
  const result = assignRun(db, {
    ticket: { connection, key },
    trackerProject,
    runnerProject: repoA,
    agent,
    now: at(minute),
  });
  if (!result.ok) throw new Error(result.reason);
  return result.run.id;
}

function trackerEvent(db: Database, delivery: string, key: TicketKey, minute: number): void {
  recordTrackerEvent(db, connection, {
    deliveryId: toDeliveryId(delivery),
    kind: "ticket.updated",
    ticketKey: key,
    projectId: trackerProject,
    labelIds: null,
    previousLabelIds: null,
    receivedAt: at(minute),
  });
}

function endedRunWithEveryRecord(db: Database, key: TicketKey): RunId {
  const runnerId = addRunner(db, { id: "mac-mini", capacity: 2, online: true, projects: [repoA] });
  trackerEvent(db, "d-1", key, 0);
  const runId = queuedRun(db, key, 1);
  db.update(runs)
    .set({
      state: "ended",
      runnerId,
      worktreeRef: toWorktreeRef("wt-1"),
      branch: "eng-1",
      agentRef: toAgentRef("agent-1"),
      startRequestedAt: at(2),
      startedAt: at(3),
      endedAt: at(20),
      agentResult: "canceled",
      prState: "none",
      startFailures: 1,
      startError: "ssh: connect timed out",
    })
    .where(eq(runs.id, runId))
    .run();
  db.insert(runStateChanges)
    .values([
      { runId, fromState: "queued", toState: "running", changedAt: at(3) },
      { runId, fromState: "running", toState: "ended", changedAt: at(20) },
    ])
    .run();
  db.insert(runQuestions)
    .values({
      runId,
      questionId: toQuestionId("q-1"),
      body: "Which database should I use?",
      options: [],
      askedAt: at(5),
      answer: "SQLite",
      answeredAt: at(6),
      answerSentAt: at(7),
    })
    .run();
  db.insert(runPermissionWaits)
    .values({
      runId,
      permissionId: toPermissionRequestId("p-1"),
      detail: "rm -rf build",
      requestedAt: at(8),
      resolvedAt: at(9),
    })
    .run();
  db.insert(notificationEvents)
    .values({
      seq: 1,
      kind: "question",
      cause: `question:${runId}`,
      runId,
      workspaceId,
      ticketKey: key,
      subject: "Ticket title",
      detail: "Which database should I use?",
      createdAt: at(10),
      resolvedAt: at(11),
    })
    .run();
  recordMcpAction(db, {
    at: at(12),
    client: "MCP · hermes",
    tool: "pause_run",
    target: null,
    runId,
    outcome: "done",
    reason: null,
  });
  db.insert(runControlRequests)
    .values({ runId, control: "pause", requestedAt: at(13), completedAt: at(14) })
    .run();
  db.insert(runCancelRequests)
    .values({ runId, requestedAt: at(18), processedAt: at(19) })
    .run();
  trackerEvent(db, "d-2", key, 15);
  return runId;
}

describe("runTimeline", () => {
  it("표마다 한 줄 이상을 시각순으로 합친다", () => {
    const db = seededDatabase();
    const key = toTicketKey("ENG-1");
    const runId = endedRunWithEveryRecord(db, key);

    const timeline = runTimeline(db, runId);
    expect(timeline).not.toBeNull();
    const entries = timeline?.entries ?? [];
    expect(entries.map((entry) => [entry.at.getUTCMinutes(), entry.source])).toEqual([
      [0, "tracker"],
      [1, "run"],
      [1, "state"],
      [2, "run"],
      [3, "run"],
      [3, "state"],
      [5, "question"],
      [6, "question"],
      [7, "question"],
      [8, "permission"],
      [9, "permission"],
      [10, "notification"],
      [12, "mcp"],
      [13, "control"],
      [14, "control"],
      [15, "tracker"],
      [18, "cancel"],
      [19, "cancel"],
      [20, "run"],
      [20, "state"],
    ]);
    expect(entries.at(-2)).toMatchObject({ event: "ended", agentResult: "canceled" });
    expect(timeline?.runs).toEqual([
      expect.objectContaining({
        id: runId,
        ticketKey: key,
        state: "ended",
        startFailures: 1,
        startError: "ssh: connect timed out",
      }),
    ]);
  });

  it("본문 글(질문·Permission 내용, 알림 제목)은 담지 않는다", () => {
    const db = seededDatabase();
    const runId = endedRunWithEveryRecord(db, toTicketKey("ENG-1"));
    const text = JSON.stringify(runTimeline(db, runId));
    expect(text).not.toContain("Which database");
    expect(text).not.toContain("SQLite");
    expect(text).not.toContain("rm -rf");
    expect(text).not.toContain("Ticket title");
  });

  it("다른 티켓의 트래커 이벤트와 다른 런의 기록은 넣지 않는다", () => {
    const db = seededDatabase();
    const runId = endedRunWithEveryRecord(db, toTicketKey("ENG-1"));
    trackerEvent(db, "d-other", toTicketKey("ENG-2"), 4);
    const other = queuedRun(db, toTicketKey("ENG-2"), 4);
    recordMcpAction(db, {
      at: at(4),
      client: "MCP · hermes",
      tool: "cancel_run",
      target: null,
      runId: other,
      outcome: "done",
      reason: null,
    });
    const entries = runTimeline(db, runId)?.entries ?? [];
    expect(entries.every((entry) => entry.runId === null || entry.runId === runId)).toBe(true);
    expect(entries.filter((entry) => entry.source === "tracker")).toHaveLength(2);
  });

  it("없는 런이면 null이다", () => {
    const db = seededDatabase();
    queuedRun(db, toTicketKey("ENG-1"), 0);
    expect(runTimeline(db, toRunId("run-missing"))).toBeNull();
  });
});

describe("ticketTimeline", () => {
  it("그 티켓의 런 여럿과 트래커 이벤트를 한 줄로 합친다", () => {
    const db = seededDatabase();
    const key = toTicketKey("ENG-1");
    const first = endedRunWithEveryRecord(db, key);
    const second = queuedRun(db, key, 30);
    trackerEvent(db, "d-3", key, 29);

    const timeline = ticketTimeline(db, key);
    expect(timeline.runs.map((run) => run.id)).toEqual([first, second]);
    const tail = timeline.entries.slice(-3).map((entry) => [entry.source, entry.runId]);
    expect(tail).toEqual([
      ["tracker", null],
      ["run", second],
      ["state", second],
    ]);
    expect(db.select().from(mcpActions).all()).toHaveLength(1);
  });

  it("런이 없는 티켓은 트래커 이벤트만 보인다", () => {
    const db = seededDatabase();
    trackerEvent(db, "d-1", toTicketKey("ENG-9"), 0);
    const timeline = ticketTimeline(db, toTicketKey("ENG-9"));
    expect(timeline.runs).toEqual([]);
    expect(timeline.entries.map((entry) => entry.source)).toEqual(["tracker"]);
  });
});
