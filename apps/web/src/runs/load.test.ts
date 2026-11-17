import { updateRunRecords } from "@factory/db";
import { toPullRequestId } from "@factory/core";
import { describe, expect, it } from "vitest";
import {
  activeCases,
  endedCases,
  labs,
  minutes,
  now,
  offlineQueuedKey,
  seedDatabase,
} from "../testing/seed";
import { loadRunsPage } from "./load";
import type { RunView } from "./model";

function byKey(runs: ReadonlyArray<RunView>): Map<string, RunView> {
  return new Map(runs.map((run) => [run.ticketKey, run]));
}

describe("loadRunsPage", () => {
  it("Ended 런의 두 축과 core 로 계산한 요약 결과를 담는다", () => {
    const { db } = seedDatabase();
    const page = loadRunsPage(db, undefined, now);
    const runs = byKey(page.runs);
    for (const c of endedCases) {
      expect({ key: c.key, ...runs.get(c.key) }).toMatchObject({
        key: c.key,
        state: "ended",
        agentResult: c.agentResult,
        prState: c.prState,
        summary: c.summary,
      });
    }
    // 에이전트 결과 여섯과 PR 상태 넷이 모두 나온다
    const ended = page.runs.flatMap((run) => (run.state === "ended" ? [run] : []));
    expect(new Set(ended.map((run) => run.agentResult)).size).toBe(6);
    expect(new Set(ended.map((run) => run.prState)).size).toBe(4);
  });

  it("상태 다섯을 담고, Ended 가 아닌 런에는 두 축이 없다", () => {
    const { db } = seedDatabase();
    const runs = byKey(loadRunsPage(db, undefined, now).runs);
    for (const c of activeCases) {
      const run = runs.get(c.key);
      expect({ key: c.key, state: run?.state }).toEqual({ key: c.key, state: c.state });
      expect(run).not.toHaveProperty("agentResult");
      expect(run).not.toHaveProperty("summary");
    }
    expect(new Set([...runs.values()].map((run) => run.state)).size).toBe(5);
  });

  it("Queued 런에 시작하지 않은 이유를 담는다(Q65·Q68)", () => {
    const { db } = seedDatabase();
    const runs = byKey(loadRunsPage(db, undefined, now).runs);
    expect(runs.get("ACME-13")).toMatchObject({
      state: "queued",
      queuedReason: { kind: "starting" },
      runner: { name: "runner-a", online: true },
    });
    expect(runs.get(offlineQueuedKey)).toMatchObject({
      state: "queued",
      queuedReason: { kind: "runner-offline" },
      runner: null,
    });
  });

  it("경과 시간, 러너, PR 링크를 담는다", () => {
    const { db } = seedDatabase();
    const runs = byKey(loadRunsPage(db, undefined, now).runs);
    const ended = runs.get("ACME-2");
    expect(ended?.executionMs).toBe(29 * 60_000);
    expect(ended?.pullRequest).toEqual({
      displayId: "#2",
      url: "https://example.com/acme/web/pull/2",
    });
    expect(ended?.trackerProject).toBe("Web");
    expect(runs.get("ACME-4")?.pullRequest).toBeNull();
    const queued = runs.get("ACME-13");
    expect(queued?.executionMs).toBeNull();
    expect(queued?.waitMs).toBe(now.getTime() - minutes(11).getTime());
  });

  it("http(s)가 아닌 PR 주소는 링크로 걸지 않는다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-2");
    if (id === undefined) throw new Error("seed");
    updateRunRecords(db, id, {
      pullRequest: {
        id: toPullRequestId("pr-2"),
        displayId: "#2",
        url: "javascript:alert(1)",
        ci: "success",
        checkedAt: now,
      },
    });
    expect(byKey(loadRunsPage(db, undefined, now).runs).get("ACME-2")?.pullRequest).toBeNull();
  });

  it("새 것부터 둔다", () => {
    const { db } = seedDatabase();
    const keys = loadRunsPage(db, undefined, now).runs.map((run) => run.ticketKey);
    expect(keys[0]).toBe(offlineQueuedKey);
    expect(keys.at(-1)).toBe("ACME-1");
  });
});

describe("Workspace 범위(ADR 0006)", () => {
  it("Workspace 를 바꾸면 그 Workspace 의 런만 담는다", () => {
    const { db } = seedDatabase();
    const commercePage = loadRunsPage(db, "ws-commerce", now);
    const labsPage = loadRunsPage(db, labs, now);
    expect(labsPage.workspace).toEqual({
      kind: "one",
      workspace: { id: "ws-labs", name: "Acme Labs" },
    });
    expect(labsPage.runs.map((run) => run.ticketKey)).toEqual(["LAB-1"]);
    expect(commercePage.runs.map((run) => run.ticketKey)).not.toContain("LAB-1");
    expect(commercePage.runs).toHaveLength(endedCases.length + activeCases.length + 1);
  });

  it("ws 가 없거나 모르는 값이면 첫 Workspace 다", () => {
    const { db } = seedDatabase();
    expect(loadRunsPage(db, undefined, now).workspace).toMatchObject({
      workspace: { id: "ws-commerce" },
    });
    expect(loadRunsPage(db, "nope", now).workspace).toMatchObject({
      workspace: { id: "ws-commerce" },
    });
  });

  it("전체에서는 런을 담지 않는다", () => {
    const { db } = seedDatabase();
    expect(loadRunsPage(db, "all", now)).toEqual({ workspace: { kind: "all" }, runs: [] });
  });
});
