import { FAKE_AGENT_PROTOCOL } from "@ganger/core/testing";
import { getRunWithRecords, saveWorkspaceBrief } from "@ganger/db";
import type { StoredRun } from "@ganger/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Harness, projectA, workspaceId } from "./test-fixtures.js";

let h: Harness;

beforeEach(() => {
  h = new Harness();
});

afterEach(async () => {
  await h.cleanup();
});

function sentBrief(run: StoredRun): string | null {
  return getRunWithRecords(h.db, run.id)?.records.agentBrief ?? null;
}

describe("런이 받은 지시서", () => {
  it("Workspace 앞뒤 지시가 비어 있으면 티켓과 통신 규약만 보내고 런에 저장한다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    const run = h.assign("ENG-1", projectA);

    await h.worker().tick();

    const expected = `Ticket ENG-1\n\nDo the thing.\n\n${FAKE_AGENT_PROTOCOL}\n`;
    expect(h.runner(runnerA).startCalls[0]?.brief).toBe(expected);
    expect(sentBrief(run)).toBe(expected);
  });

  it("앞 지시 → 티켓 → 뒤 지시 → 통신 규약 순서로 합쳐 보낸다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    saveWorkspaceBrief(h.db, {
      id: workspaceId,
      brief: { before: "Read AGENTS.md first.", after: "Push and open a PR to develop." },
    });
    const run = h.assign("ENG-1", projectA);

    await h.worker().tick();

    const expected = [
      "Read AGENTS.md first.",
      "Ticket ENG-1\n\nDo the thing.",
      "Push and open a PR to develop.",
      FAKE_AGENT_PROTOCOL,
    ].join("\n\n");
    expect(h.runner(runnerA).startCalls[0]?.brief).toBe(`${expected}\n`);
    expect(sentBrief(run)).toBe(`${expected}\n`);
  });

  it("앞뒤 지시를 바꾸면 새로 시작하는 런부터 적용하고 도는 런의 지시서는 그대로 둔다", async () => {
    const runnerA = h.addRunner({ id: "runner-a", capacity: 1, projects: [projectA] });
    saveWorkspaceBrief(h.db, { id: workspaceId, brief: { before: "Old rule.", after: "" } });
    const first = h.assign("ENG-1", projectA);
    const second = h.assign("ENG-2", projectA);
    const worker = h.worker();

    await worker.tick();
    const firstBrief = sentBrief(first);
    expect(firstBrief?.startsWith("Old rule.\n\n")).toBe(true);
    expect(sentBrief(second)).toBeNull();

    saveWorkspaceBrief(h.db, { id: workspaceId, brief: { before: "New rule.", after: "" } });
    await worker.tick();
    expect(sentBrief(first)).toBe(firstBrief);

    const found = getRunWithRecords(h.db, first.id)?.run;
    if (found === undefined || found.state === "queued" || found.state === "ended") {
      throw new Error("first run should be running");
    }
    h.runner(runnerA).report(found.worktree, { outcome: "succeeded", body: "done" });
    await worker.tick();
    await worker.tick();

    expect(sentBrief(second)?.startsWith("New rule.\n\n")).toBe(true);
    expect(sentBrief(first)).toBe(firstBrief);
  });
});
