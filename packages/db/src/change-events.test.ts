import {
  toAgentRef,
  toCodeHostKind,
  toDeliveryId,
  toLabelId,
  toMailboxRef,
  toPermissionRequestId,
  toPullRequestId,
  toQuestionId,
  toRunnerKind,
  toTicketKey,
  toTrackerKind,
  toTrackerProjectId,
  toTrackerStateId,
  toWorktreeRef,
} from "@ganger/core";
import type { RunId, RunnerId } from "@ganger/core";
import { describe, expect, it } from "vitest";
import {
  CHANGE_EVENTS_KEEP_MS,
  changeResumeFrom,
  latestChangeSeq,
  listChangesAfter,
  markTrackerChanged,
  prunedChangeSeq,
  pruneChangeEvents,
  recordSettingsChange,
} from "./change-events.js";
import type { ChangeKind } from "./change-events.js";
import { inTransaction, openDatabase } from "./database.js";
import type { Database } from "./database.js";
import { recordTrackerEvent } from "./events.js";
import { toCodeHostConnectionId } from "./ids.js";
import { trackerReadGeneration } from "./tracker-reads.js";
import { recordMcpAction } from "./mcp-actions.js";
import { MigrationError, checkSchema, loadMigrations, migrate } from "./migrate.js";
import {
  denyPermissionWait,
  markDenialSent,
  recordPermissionWaits,
  resolvePermissionWaits,
} from "./permissions.js";
import { answerRunQuestion, markAnswerSent, recordRunQuestions } from "./questions.js";
import {
  completeLogTailRequest,
  completeRunControlRequest,
  completeRunnerCheckRequest,
  markCancelRequestProcessed,
  markRunControlOutcomeUnknown,
  requestLogTail,
  requestRunCancel,
  requestRunControl,
  requestRunnerCheck,
} from "./requests.js";
import {
  assignRun,
  changeRunState,
  clearStartRequested,
  fillRunTicketTitle,
  recordStartFailure,
  recordStartRequested,
  setQueuedRunRunner,
  updateRunRecords,
} from "./runs.js";
import { SecretBox } from "./secret-box.js";
import {
  recordProviderUsage,
  recordRunnerCheck,
  removeWorkspaceTrackerProject,
  replaceMapping,
  saveAutoAssignLabel,
  saveCodeHostConnection,
  saveInstallAddresses,
  saveMcpWriteAllowed,
  saveRunner,
  saveRunnerCapacity,
  saveTrackerConnection,
  saveWorkspace,
  saveWorkspaceTrackerProject,
  setRunnerMailbox,
} from "./settings.js";
import {
  KEY,
  addRunner,
  agent,
  connection,
  repoA,
  seededDatabase,
  trackerProject,
  workspaceId,
} from "./test-fixtures.js";

const box = new SecretBox(KEY);
const at = (minute: number) => new Date(Date.UTC(2026, 10, 20, 0, minute));
const started = {
  worktree: toWorktreeRef("repo::/wt/1"),
  branch: "acme/ganger-ENG-1-1",
  agentRef: toAgentRef("agent-1"),
};

interface World {
  db: Database;
  runnerId: RunnerId;
  queued: RunId;
  running: RunId;
}

function world(): World {
  const db = seededDatabase();
  const runnerId = addRunner(db, { id: "runner-a", capacity: 3, online: true, projects: [repoA] });
  const assign = (key: string) => {
    const result = assignRun(db, {
      ticket: { connection, key: toTicketKey(key) },
      trackerProject,
      runnerProject: repoA,
      agent,
      runnerId,
    });
    if (!result.ok) throw new Error(result.reason);
    return result.run.id;
  };
  const queued = assign("ENG-1");
  const running = assign("ENG-2");
  const moved = changeRunState(db, running, { to: "running", started });
  if (!moved.ok) throw new Error("could not start");
  return { db, runnerId, queued, running };
}

function changesSince(
  db: Database,
  after: number,
): Array<{ kind: ChangeKind; targetId: string | null }> {
  return listChangesAfter(db, after).map(({ kind, targetId }) => ({ kind, targetId }));
}

function kindsSince(db: Database, after: number): ChangeKind[] {
  return listChangesAfter(db, after).map((change) => change.kind);
}

const question = { id: toQuestionId("q-1"), body: "계속할까요?", options: [], askedAt: at(1) };
const permission = { id: toPermissionRequestId("p-1"), detail: "rm -rf", requestedAt: at(1) };

interface WriteCase {
  name: string;
  kinds: ChangeKind[];
  prepare?: (w: World) => void;
  write: (w: World) => void;
}

const writes: WriteCase[] = [
  {
    name: "assignRun",
    kinds: ["assignment"],
    write: (w) => {
      assignRun(w.db, {
        ticket: { connection, key: toTicketKey("ENG-9") },
        trackerProject,
        runnerProject: repoA,
        agent,
      });
    },
  },
  {
    name: "changeRunState",
    kinds: ["run"],
    write: (w) => {
      changeRunState(w.db, w.running, { to: "paused" });
    },
  },
  {
    name: "fillRunTicketTitle",
    kinds: ["run"],
    write: (w) => fillRunTicketTitle(w.db, w.queued, "로그인 고치기"),
  },
  {
    name: "recordStartFailure",
    kinds: ["run"],
    write: (w) => {
      recordStartFailure(w.db, w.queued, { failures: 1, error: "busy" });
    },
  },
  {
    name: "setQueuedRunRunner",
    kinds: ["run"],
    write: (w) => {
      setQueuedRunRunner(w.db, w.queued, null);
    },
  },
  {
    name: "updateRunRecords",
    kinds: ["run"],
    write: (w) => {
      updateRunRecords(w.db, w.running, { trackerStateSetAt: at(2) });
    },
  },
  {
    name: "recordRunQuestions",
    kinds: ["run"],
    write: (w) => {
      recordRunQuestions(w.db, w.running, [question]);
    },
  },
  {
    name: "answerRunQuestion",
    kinds: ["run"],
    prepare: (w) => recordRunQuestions(w.db, w.running, [question]),
    write: (w) => {
      answerRunQuestion(w.db, { runId: w.running, questionId: question.id, answer: "네" });
    },
  },
  {
    name: "markAnswerSent",
    kinds: ["run"],
    prepare: (w) => {
      recordRunQuestions(w.db, w.running, [question]);
      answerRunQuestion(w.db, { runId: w.running, questionId: question.id, answer: "네" });
    },
    write: (w) => {
      markAnswerSent(w.db, { runId: w.running, questionId: question.id });
    },
  },
  {
    name: "recordPermissionWaits",
    kinds: ["run"],
    write: (w) => {
      recordPermissionWaits(w.db, w.running, [permission]);
    },
  },
  {
    name: "resolvePermissionWaits",
    kinds: ["run"],
    prepare: (w) => recordPermissionWaits(w.db, w.running, [permission]),
    write: (w) => {
      resolvePermissionWaits(w.db, w.running, []);
    },
  },
  {
    name: "denyPermissionWait",
    kinds: ["run"],
    prepare: (w) => recordPermissionWaits(w.db, w.running, [permission]),
    write: (w) => {
      denyPermissionWait(w.db, {
        runId: w.running,
        permissionId: permission.id,
        reason: "안 돼요",
      });
    },
  },
  {
    name: "markDenialSent",
    kinds: ["run"],
    prepare: (w) => {
      recordPermissionWaits(w.db, w.running, [permission]);
      denyPermissionWait(w.db, {
        runId: w.running,
        permissionId: permission.id,
        reason: "안 돼요",
      });
    },
    write: (w) => {
      markDenialSent(w.db, { runId: w.running, permissionId: permission.id });
    },
  },
  {
    name: "requestLogTail",
    kinds: ["run"],
    write: (w) => requestLogTail(w.db, w.running, at(3)),
  },
  {
    name: "completeLogTailRequest",
    kinds: ["run"],
    prepare: (w) => requestLogTail(w.db, w.running, at(3)),
    write: (w) => {
      completeLogTailRequest(w.db, {
        runId: w.running,
        requestedAt: at(3),
        completedAt: at(4),
        lines: ["ok"],
      });
    },
  },
  {
    name: "requestRunCancel",
    kinds: ["run"],
    write: (w) => {
      requestRunCancel(w.db, w.running, at(3));
    },
  },
  {
    name: "markCancelRequestProcessed",
    kinds: ["run"],
    prepare: (w) => requestRunCancel(w.db, w.running, at(3)),
    write: (w) => {
      markCancelRequestProcessed(w.db, w.running, at(4));
    },
  },
  {
    name: "requestRunControl",
    kinds: ["run"],
    write: (w) => {
      requestRunControl(w.db, w.running, "pause", at(3));
    },
  },
  {
    name: "markRunControlOutcomeUnknown",
    kinds: ["run"],
    prepare: (w) => requestRunControl(w.db, w.running, "pause", at(3)),
    write: (w) => {
      markRunControlOutcomeUnknown(w.db, { runId: w.running, requestedAt: at(3) });
    },
  },
  {
    name: "completeRunControlRequest",
    kinds: ["run"],
    prepare: (w) => requestRunControl(w.db, w.running, "pause", at(3)),
    write: (w) => {
      completeRunControlRequest(w.db, {
        runId: w.running,
        requestedAt: at(3),
        completedAt: at(4),
        error: null,
      });
    },
  },
  {
    name: "recordMcpAction(런)",
    kinds: ["run", "settings"],
    write: (w) =>
      recordMcpAction(w.db, {
        at: at(3),
        client: "codex",
        tool: "cancel_run",
        target: "ENG-2",
        runId: w.running,
        outcome: "done",
        reason: null,
      }),
  },
  {
    name: "requestRunnerCheck",
    kinds: ["runner"],
    write: (w) => requestRunnerCheck(w.db, w.runnerId, at(3)),
  },
  {
    name: "completeRunnerCheckRequest",
    kinds: ["runner"],
    prepare: (w) => requestRunnerCheck(w.db, w.runnerId, at(3)),
    write: (w) => {
      completeRunnerCheckRequest(w.db, {
        runnerId: w.runnerId,
        requestedAt: at(3),
        completedAt: at(4),
        error: "down",
      });
    },
  },
  {
    name: "recordRunnerCheck",
    kinds: ["runner"],
    write: (w) =>
      recordRunnerCheck(w.db, {
        runnerId: w.runnerId,
        online: false,
        checkedAt: at(5),
        error: null,
        projects: null,
        assignmentBlocked: null,
      }),
  },
  {
    name: "recordProviderUsage",
    kinds: ["runner"],
    write: (w) =>
      recordProviderUsage(w.db, {
        runnerId: w.runnerId,
        readAt: at(5),
        reading: { kind: "unreadable" },
      }),
  },
  {
    name: "saveRunner",
    kinds: ["runner"],
    write: (w) =>
      saveRunner(w.db, {
        id: w.runnerId,
        kind: toRunnerKind("fake"),
        name: "새 이름",
        config: {},
        capacity: 3,
      }),
  },
  {
    name: "saveRunnerCapacity",
    kinds: ["runner"],
    write: (w) => {
      saveRunnerCapacity(w.db, w.runnerId, 5);
    },
  },
  {
    name: "setRunnerMailbox",
    kinds: ["runner"],
    write: (w) => setRunnerMailbox(w.db, w.runnerId, toMailboxRef("terminal-1")),
  },
  {
    name: "saveWorkspace",
    kinds: ["workspace"],
    write: (w) => saveWorkspace(w.db, { id: workspaceId, name: "Acme Web" }),
  },
  {
    name: "saveTrackerConnection",
    kinds: ["settings", "tracker"],
    write: (w) =>
      saveTrackerConnection(w.db, box, {
        id: connection,
        kind: toTrackerKind("fake"),
        name: "Acme 2",
        config: {},
        secrets: { apiKey: "secret" },
      }),
  },
  {
    name: "saveCodeHostConnection",
    kinds: ["settings"],
    write: (w) =>
      saveCodeHostConnection(w.db, box, {
        id: toCodeHostConnectionId("gh-1"),
        kind: toCodeHostKind("github"),
        name: "GitHub",
        config: {},
        secrets: { token: "t" },
      }),
  },
  {
    name: "saveWorkspaceTrackerProject(더하기)",
    kinds: ["settings", "tracker"],
    write: (w) => {
      saveWorkspaceTrackerProject(w.db, {
        workspaceId,
        connection,
        projectId: trackerProjectOther,
        name: "Docs",
        inProgressStateId: null,
      });
    },
  },
  {
    name: "saveWorkspaceTrackerProject(In Progress 상태)",
    kinds: ["settings"],
    write: (w) => {
      saveWorkspaceTrackerProject(w.db, {
        workspaceId,
        connection,
        projectId: trackerProject,
        name: "Web",
        inProgressStateId: toTrackerStateId("doing"),
      });
    },
  },
  {
    name: "removeWorkspaceTrackerProject",
    kinds: ["settings", "tracker"],
    write: (w) => {
      removeWorkspaceTrackerProject(w.db, { workspaceId, connection, projectId: trackerProject });
    },
  },
  {
    name: "replaceMapping",
    kinds: ["settings"],
    write: (w) => {
      replaceMapping(w.db, {
        connection,
        trackerProject,
        agent,
        repos: [{ project: repoA, isDefault: true, labelId: null }],
      });
    },
  },
  {
    name: "saveAutoAssignLabel",
    kinds: ["settings"],
    write: (w) =>
      saveAutoAssignLabel(w.db, { workspaceId, connection, labelId: toLabelId("label-1") }),
  },
  {
    name: "saveMcpWriteAllowed",
    kinds: ["settings"],
    write: (w) => saveMcpWriteAllowed(w.db, true, at(3)),
  },
  {
    name: "saveInstallAddresses",
    kinds: ["settings"],
    write: (w) =>
      saveInstallAddresses(
        w.db,
        { webAddress: "https://ganger.example.com", webhookAddress: null },
        at(3),
      ),
  },
  {
    name: "recordTrackerEvent",
    kinds: ["tracker"],
    write: (w) => {
      recordTrackerEvent(w.db, connection, {
        deliveryId: toDeliveryId("d-1"),
        kind: "ticket.updated",
        projectId: trackerProject,
        ticketKey: toTicketKey("ENG-1"),
        labelIds: null,
        previousLabelIds: null,
        receivedAt: at(3),
      });
    },
  },
  {
    name: "markTrackerChanged",
    kinds: ["tracker"],
    write: (w) => markTrackerChanged(w.db, connection),
  },
];

const trackerProjectOther = toTrackerProjectId("tp-2");

class Rollback extends Error {}

describe("쓰기 함수는 같은 트랜잭션에서 변경 기록 줄을 쓴다", () => {
  it.for(writes)("$name", (writeCase) => {
    const w = world();
    writeCase.prepare?.(w);
    const before = latestChangeSeq(w.db);

    expect(() =>
      inTransaction(w.db, () => {
        writeCase.write(w);
        throw new Rollback();
      }),
    ).toThrow(Rollback);
    expect(listChangesAfter(w.db, before)).toEqual([]);

    writeCase.write(w);
    expect(kindsSince(w.db, before).toSorted()).toEqual(writeCase.kinds.toSorted());
  });

  it("런 줄은 그 런의 id와 Workspace를 싣는다", () => {
    const w = world();
    const before = latestChangeSeq(w.db);
    changeRunState(w.db, w.running, { to: "paused" });
    expect(listChangesAfter(w.db, before)).toEqual([
      { seq: before + 1, kind: "run", targetId: w.running, workspaceId, part: null },
    ]);
  });

  it("로그 요청과 그 결과는 로그 줄로 따로 표시한다", () => {
    const w = world();
    const before = latestChangeSeq(w.db);
    requestLogTail(w.db, w.running, at(3));
    completeLogTailRequest(w.db, {
      runId: w.running,
      requestedAt: at(3),
      completedAt: at(4),
      lines: [],
    });
    expect(listChangesAfter(w.db, before).map((change) => change.part)).toEqual(["log", "log"]);
  });

  it("트래커 줄을 쓰면 같은 트랜잭션에서 그 연결의 서버 캐시 세대도 오른다", () => {
    const w = world();
    const before = latestChangeSeq(w.db);
    const generation = trackerReadGeneration(w.db, connection);
    expect(() =>
      inTransaction(w.db, () => {
        markTrackerChanged(w.db, connection);
        throw new Rollback();
      }),
    ).toThrow(Rollback);
    expect(trackerReadGeneration(w.db, connection)).toBe(generation);

    markTrackerChanged(w.db, connection);
    expect(changesSince(w.db, before)).toEqual([{ kind: "tracker", targetId: connection }]);
    expect(trackerReadGeneration(w.db, connection)).toBe(generation + 1);
  });
});

describe("화면에 보이는 값이 그대로면 줄을 쓰지 않는다", () => {
  let minute = 10;
  const later = () => at((minute += 1));
  const check = (w: World) =>
    recordRunnerCheck(w.db, {
      runnerId: w.runnerId,
      online: true,
      checkedAt: later(),
      error: null,
      projects: [{ id: repoA, displayName: repoA, setupState: "ready" }],
      assignmentBlocked: false,
    });

  it.for<{ name: string; prepare?: (w: World) => void; write: (w: World) => void }>([
    {
      name: "같은 Question을 다시 기록",
      write: (w) => {
        recordRunQuestions(w.db, w.running, [question]);
      },
    },
    {
      name: "같은 Permission 대기를 다시 기록",
      write: (w) => {
        recordPermissionWaits(w.db, w.running, [permission]);
      },
    },
    {
      name: "열린 대기가 그대로",
      prepare: (w) => recordPermissionWaits(w.db, w.running, [permission]),
      write: (w) => {
        resolvePermissionWaits(w.db, w.running, [permission.id]);
      },
    },
    { name: "같은 점검 결과(점검 시각만 다름)", write: check },
    {
      name: "같은 사용량(읽은 시각만 다름)",
      write: (w) =>
        recordProviderUsage(w.db, {
          runnerId: w.runnerId,
          readAt: later(),
          reading: { kind: "unreadable" },
        }),
    },
    {
      name: "같은 PR 값을 다시 씀(확인 시각만 다름)",
      write: (w) => {
        updateRunRecords(w.db, w.running, {
          pullRequest: {
            id: toPullRequestId("pr-1"),
            displayId: "#1",
            url: "https://code.example.com/acme/pull/1",
            ci: "passing",
            checkedAt: later(),
          },
        });
      },
    },
    {
      name: "같은 Mailbox",
      write: (w) => setRunnerMailbox(w.db, w.runnerId, toMailboxRef("terminal-1")),
    },
    {
      name: "같은 Workspace 값",
      write: (w) => saveWorkspace(w.db, { id: workspaceId, name: "Acme" }),
    },
    {
      name: "같은 capacity",
      write: (w) => {
        saveRunnerCapacity(w.db, w.runnerId, 3);
      },
    },
    {
      name: "같은 러너로 다시 정함",
      write: (w) => {
        setQueuedRunRunner(w.db, w.queued, w.runnerId);
      },
    },
    {
      name: "시작 요청 시각(화면에 보이지 않음)",
      write: (w) => {
        recordStartRequested(w.db, w.queued, later());
        clearStartRequested(w.db, w.queued);
      },
    },
    {
      name: "이미 제목이 있는 런",
      write: (w) => fillRunTicketTitle(w.db, w.queued, `제목 ${minute}`),
    },
  ])("$name", (noChange) => {
    const w = world();
    noChange.prepare?.(w);
    noChange.write(w);
    const settled = latestChangeSeq(w.db);
    noChange.write(w);
    expect(listChangesAfter(w.db, settled)).toEqual([]);
  });
});

describe("이어 받기와 reset", () => {
  it("빈 DB의 지금 번호는 0이고, 0으로 이어 받을 수 있다", () => {
    const w = world();
    w.db.$client.exec(
      "DELETE FROM change_events; DELETE FROM sqlite_sequence WHERE name = 'change_events'",
    );
    expect(latestChangeSeq(w.db)).toBe(0);
    expect(changeResumeFrom(w.db, 0)).toEqual({ kind: "resume", latest: 0 });
  });

  it("하루가 지나 표가 비어도 지금 번호(sqlite_sequence)로는 reset이 나지 않는다", () => {
    const w = world();
    recordSettingsChange(w.db, undefined, at(0));
    const latest = latestChangeSeq(w.db);
    pruneChangeEvents(w.db, new Date(Date.now() + 2 * CHANGE_EVENTS_KEEP_MS));
    expect(listChangesAfter(w.db, 0)).toEqual([]);
    expect(latestChangeSeq(w.db)).toBe(latest);
    expect(changeResumeFrom(w.db, latest)).toEqual({ kind: "resume", latest });
  });

  it("지운 번호보다 작은 번호는 reset, 지금보다 큰 번호도 reset이다", () => {
    const w = world();
    const latest = latestChangeSeq(w.db);
    pruneChangeEvents(w.db, new Date(Date.now() + 2 * CHANGE_EVENTS_KEEP_MS));
    expect(changeResumeFrom(w.db, latest - 1)).toEqual({ kind: "reset", latest, reason: "pruned" });
    expect(changeResumeFrom(w.db, latest + 1)).toEqual({ kind: "reset", latest, reason: "ahead" });
  });

  it("지운 번호의 상한을 따로 남겨, 남은 줄이 있어도 그 앞 번호로는 이어 받지 않는다", () => {
    const w = world();
    const now = new Date();
    const old = new Date(now.getTime() - CHANGE_EVENTS_KEEP_MS - 60_000);
    const start = latestChangeSeq(w.db);
    recordSettingsChange(w.db, undefined, now);
    recordSettingsChange(w.db, undefined, old);
    recordSettingsChange(w.db, undefined, now);

    expect(pruneChangeEvents(w.db, now)).toBeGreaterThan(0);

    expect(prunedChangeSeq(w.db)).toBe(start + 2);
    expect(listChangesAfter(w.db, 0).map((change) => change.seq)).toEqual([start + 3]);
    expect(changeResumeFrom(w.db, start + 1).kind).toBe("reset");
    expect(changeResumeFrom(w.db, start + 2)).toEqual({ kind: "resume", latest: start + 3 });
  });
});

describe("하루 지난 줄 지우기", () => {
  it("하루가 지난 줄만 지우고, 지울 줄이 없으면 아무것도 바꾸지 않는다", () => {
    const w = world();
    const now = new Date();
    const fresh = new Date(now.getTime() - CHANGE_EVENTS_KEEP_MS + 60_000);
    const stale = new Date(now.getTime() - CHANGE_EVENTS_KEEP_MS - 60_000);
    w.db.$client.exec("DELETE FROM change_events");
    recordSettingsChange(w.db, undefined, stale);
    recordSettingsChange(w.db, undefined, fresh);
    const freshSeq = latestChangeSeq(w.db);

    expect(pruneChangeEvents(w.db, now)).toBe(1);
    expect(listChangesAfter(w.db, 0).map((change) => change.seq)).toEqual([freshSeq]);
    const through = prunedChangeSeq(w.db);

    expect(pruneChangeEvents(w.db, now)).toBe(0);
    expect(prunedChangeSeq(w.db)).toBe(through);
  });
});

describe("되돌리기(one-way 마이그레이션)", () => {
  it("change_events 마이그레이션을 적용한 DB는 이전 버전이 열지 않는다", () => {
    const db = openDatabase(":memory:");
    const migrations = loadMigrations();
    migrate(db, migrations);
    const previous = migrations.filter((migration) => !migration.name.endsWith("_change_events"));
    expect(previous).toHaveLength(migrations.length - 1);

    expect(() => migrate(db, previous)).toThrow(MigrationError);
    expect(checkSchema(db, previous)).toEqual({
      kind: "ahead",
      unknown: [expect.stringMatching(/_change_events$/)],
    });
  });
});
