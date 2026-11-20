import { toTicketKey } from "@ganger/core";
import { useLogger } from "@ganger/log";
import { memoryLogger } from "@ganger/log/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inTransaction, onCommit } from "./database.js";
import { assignRun, changeRunState } from "./runs.js";
import { recordRunnerCheck } from "./settings.js";
import {
  addRunner,
  agent,
  connection,
  repoA,
  seededDatabase,
  trackerProject,
} from "./test-fixtures.js";

let logger = memoryLogger();
let restore: () => void = () => undefined;

beforeEach(() => {
  logger = memoryLogger();
  restore = useLogger(logger);
});
afterEach(() => restore());

function assigned(db: ReturnType<typeof seededDatabase>) {
  const result = assignRun(db, {
    ticket: { connection, key: toTicketKey("ACME-1") },
    trackerProject,
    runnerProject: repoA,
    agent,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.run;
}

describe("onCommit", () => {
  it("runs right away outside a transaction", () => {
    const db = seededDatabase();
    const ran: string[] = [];
    onCommit(db, () => ran.push("now"));
    expect(ran).toEqual(["now"]);
  });

  it("waits for the outer commit and drops work from a rolled back savepoint", () => {
    const db = seededDatabase();
    const ran: string[] = [];
    inTransaction(db, () => {
      onCommit(db, () => ran.push("outer"));
      try {
        inTransaction(db, () => {
          onCommit(db, () => ran.push("rolled back"));
          throw new Error("undo");
        });
      } catch {
        ran.push("caught");
      }
      inTransaction(db, () => onCommit(db, () => ran.push("inner kept")));
      expect(ran).toEqual(["caught"]);
    });
    expect(ran).toEqual(["caught", "outer", "inner kept"]);
  });

  it("drops everything when the outer transaction rolls back", () => {
    const db = seededDatabase();
    const ran: string[] = [];
    expect(() =>
      inTransaction(db, () => {
        onCommit(db, () => ran.push("never"));
        throw new Error("undo");
      }),
    ).toThrow("undo");
    expect(ran).toEqual([]);
  });
});

describe("domain info lines", () => {
  it("writes run.assigned and run.state_changed after they are saved", () => {
    const db = seededDatabase();
    const runner = addRunner(db, { id: "runner-1", capacity: 1, online: true, projects: [repoA] });
    const run = assigned(db);
    changeRunState(db, run.id, { to: "ended", agentResult: "canceled", prState: "none" });
    expect(
      logger.entries
        .filter((entry) => entry.event.startsWith("run."))
        .map((entry) => [entry.level, entry.event, entry.fields]),
    ).toEqual([
      [
        "info",
        "run.assigned",
        expect.objectContaining({ runId: run.id, ticketKey: "ACME-1", runnerId: runner }),
      ],
      [
        "info",
        "run.state_changed",
        expect.objectContaining({
          runId: run.id,
          from: "queued",
          to: "ended",
          outcome: "canceled",
        }),
      ],
    ]);
  });

  it("writes nothing for a state change that a caller rolls back", () => {
    const db = seededDatabase();
    const run = assigned(db);
    logger.entries.length = 0;
    expect(() =>
      inTransaction(db, () => {
        changeRunState(db, run.id, { to: "ended", agentResult: "canceled", prState: "none" });
        throw new Error("undo");
      }),
    ).toThrow("undo");
    expect(logger.entries).toEqual([]);
  });

  it("writes runner.online_changed only when online flips", () => {
    const db = seededDatabase();
    const runnerId = addRunner(db, {
      id: "runner-1",
      capacity: 1,
      online: true,
      projects: [repoA],
    });
    logger.entries.length = 0;
    const check = (online: boolean) =>
      recordRunnerCheck(db, {
        runnerId,
        online,
        checkedAt: new Date(1),
        error: online ? null : { kind: "unreachable", detail: "ssh exited with 255" },
        projects: null,
        assignmentBlocked: null,
      });
    check(true);
    check(false);
    check(false);
    check(true);
    expect(logger.entries.map((entry) => [entry.event, entry.fields.online])).toEqual([
      ["runner.online_changed", false],
      ["runner.online_changed", true],
    ]);
  });
});
