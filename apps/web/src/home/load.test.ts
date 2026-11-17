import {
  toAgentId,
  toRunnerProjectId,
  toTicketKey,
  toTrackerProjectId,
  toWorktreeRef,
} from "@factory/core";
import { assignRun, changeRunState, updateRunRecords } from "@factory/db";
import type { Database } from "@factory/db";
import { describe, expect, it } from "vitest";
import {
  connection,
  endedCases,
  labs,
  minutes,
  now,
  offlineQueuedKey,
  seedDatabase,
} from "../testing/seed";
import { loadHomePage } from "./load";
import type { AttentionItem, HomeRun } from "./model";

const keys = (runs: ReadonlyArray<HomeRun>) => runs.map((run) => run.ticketKey);
const attentionKeys = (items: ReadonlyArray<AttentionItem>) =>
  items.map((item) => (item.kind === "run" ? item.run.ticketKey : `runner:${item.runner.id}`));

/** ws-labs 에 Failed 로 끝난 런 하나를 더한다 */
function addLabsFailedRun(db: Database): void {
  const result = assignRun(db, {
    ticket: { connection, key: toTicketKey("LAB-2") },
    trackerProject: toTrackerProjectId("tp-lab"),
    runnerProject: toRunnerProjectId("github:acme/web"),
    agent: toAgentId("claude"),
    now: minutes(60),
  });
  if (!result.ok) throw new Error(result.reason);
  const { id } = result.run;
  for (const change of [
    changeRunState(db, id, { to: "running", worktree: toWorktreeRef("wt-LAB-2") }, minutes(61)),
    changeRunState(db, id, { to: "ended", agentResult: "timed-out", prState: "none" }, minutes(90)),
  ]) {
    if (!change.ok) throw new Error(JSON.stringify(change));
  }
}

describe("loadHomePage", () => {
  it("런을 손댈 일, 실행 중, Queued 로 나눈다", () => {
    const { db } = seedDatabase();
    const page = loadHomePage(db, "ws-commerce", now);

    const attention = attentionKeys(page.attention);
    // 입력 기다림·연결 끊김이 먼저, 그다음 Human Check·Failed 인 Ended 런(새 것부터)
    expect(attention.slice(0, 2)).toEqual(["ACME-11", "ACME-12"]);
    expect(attention.slice(2).toSorted()).toEqual(
      endedCases
        .filter((c) => c.summary !== "merged")
        .map((c) => c.key)
        .toSorted(),
    );
    expect(attention.slice(2)).toEqual(attention.slice(2).toSorted().toReversed());
    expect(attention).not.toContain("ACME-1"); // Merged

    expect(keys(page.running)).toEqual(["ACME-10"]);
    expect(keys(page.queued)).toEqual(["ACME-13", offlineQueuedKey]);
  });

  it("Queued 는 들어온 순서로 보이고, 순서에서 빠진 런에는 이유를 담는다(Q68)", () => {
    const { db } = seedDatabase();
    // ACME-13 보다 먼저 들어온 런이 없으니 하나를 일찍 할당한 것처럼 더한다
    const early = assignRun(db, {
      ticket: { connection, key: toTicketKey("ACME-20") },
      trackerProject: toTrackerProjectId("tp-web"),
      runnerProject: toRunnerProjectId("github:acme/web"),
      agent: toAgentId("claude"),
      now: minutes(0.5),
    });
    if (!early.ok) throw new Error(early.reason);

    const page = loadHomePage(db, "ws-commerce", now);
    expect(keys(page.queued)).toEqual(["ACME-20", "ACME-13", offlineQueuedKey]);
    const offline = page.queued.find((run) => run.ticketKey === offlineQueuedKey);
    expect(offline).toMatchObject({ queuedReason: { kind: "runner-offline" }, runner: null });
  });

  it("입력 기다림과 연결 끊김 런을 상태 그대로 손댈 일에 담는다", () => {
    const { db } = seedDatabase();
    const page = loadHomePage(db, "ws-commerce", now);
    const runs = page.attention.flatMap((item) => (item.kind === "run" ? [item.run] : []));
    expect(runs.find((run) => run.ticketKey === "ACME-11")?.state).toBe("waiting-for-input");
    expect(runs.find((run) => run.ticketKey === "ACME-12")?.state).toBe("disconnected");
  });

  it("손댈 일의 Ended 런은 에이전트 결과와 PR 상태를 따로 담는다", () => {
    const { db } = seedDatabase();
    const page = loadHomePage(db, "ws-commerce", now);
    const run = page.attention.find(
      (item) => item.kind === "run" && item.run.ticketKey === "ACME-2",
    );
    expect(run).toMatchObject({
      kind: "run",
      run: {
        state: "ended",
        agentResult: "exited-with-error",
        prState: "open",
        summary: "human-check",
      },
    });
  });

  it("같은 티켓에 새 런이 있으면 지난 Ended 런은 손댈 일에서 빠진다", () => {
    const { db } = seedDatabase();
    const again = assignRun(db, {
      ticket: { connection, key: toTicketKey("ACME-3") },
      trackerProject: toTrackerProjectId("tp-web"),
      runnerProject: toRunnerProjectId("github:acme/web"),
      agent: toAgentId("claude"),
      now: minutes(100),
    });
    if (!again.ok) throw new Error(again.reason);
    const page = loadHomePage(db, "ws-commerce", now);
    expect(attentionKeys(page.attention)).not.toContain("ACME-3");
    expect(keys(page.queued)).toContain("ACME-3");
  });

  it("Human Check 런은 사람이 PR 을 병합하거나 닫으면 손댈 일에서 빠진다(Q89)", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-2");
    if (id === undefined) throw new Error("ACME-2 missing");
    updateRunRecords(db, id, { laterPrState: { state: "merged", at: minutes(110) } });
    const page = loadHomePage(db, "ws-commerce", now);
    expect(attentionKeys(page.attention)).not.toContain("ACME-2");
    // Failed 런은 이후 PR 상태와 상관없이 남는다
    const failedId = ids.get("ACME-5");
    if (failedId === undefined) throw new Error("ACME-5 missing");
    updateRunRecords(db, failedId, { laterPrState: { state: "closed", at: minutes(110) } });
    expect(attentionKeys(loadHomePage(db, "ws-commerce", now).attention)).toContain("ACME-5");
  });

  it("전체에서는 모든 Workspace 의 손댈 일만 담는다(ADR 0006)", () => {
    const { db } = seedDatabase();
    addLabsFailedRun(db);
    const page = loadHomePage(db, "all", now);
    expect(page.workspace.kind).toBe("all");
    expect(page.running).toEqual([]);
    expect(page.queued).toEqual([]);
    const attention = attentionKeys(page.attention);
    expect(attention).toContain("LAB-2");
    expect(attention).toContain("ACME-11");
    expect(attention).not.toContain("LAB-1"); // 실행 중
    const lab = page.attention.find(
      (item) => item.kind === "run" && item.run.ticketKey === "LAB-2",
    );
    expect(lab).toMatchObject({ run: { workspace: { id: labs, name: "Acme Labs" } } });
  });

  it("Workspace 하나에서는 그 Workspace 의 런만 담는다", () => {
    const { db } = seedDatabase();
    addLabsFailedRun(db);
    const page = loadHomePage(db, labs, now);
    expect(attentionKeys(page.attention)).toEqual(["LAB-2"]);
    expect(keys(page.running)).toEqual(["LAB-1"]);
    expect(page.queued).toEqual([]);
  });
});
