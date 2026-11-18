import {
  toAgentId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTicketKey,
  toTrackerProjectId,
  toAgentRef,
  toWorktreeRef,
} from "@factory/core";
import { assignRun, changeRunState, saveRunner, updateRunRecords } from "@factory/db";
import type { Database } from "@factory/db";
import { describe, expect, it } from "vitest";
import { Route, reloadOnEnter } from "../routes/_app/runners";
import {
  addUnreachedCanceledRun,
  breakGitHubAuth,
  connection,
  minutes,
  now,
  seedDatabase,
} from "../testing/seed";
import { loadRunnersPage } from "./load";
import type { RunnerView } from "./model";

function runner(db: Database, name: string): RunnerView {
  const found = loadRunnersPage(db, now).runners.find((r) => r.name === name);
  if (found === undefined) throw new Error(`no runner ${name}`);
  return found;
}

const keys = (runs: ReadonlyArray<{ ticketKey: string }>) => runs.map((run) => run.ticketKey);

/**
 * Offline 인 runner-b 에 런 둘을 더한다. 하나는 러너에 닿지 않아 Disconnected 가 된 런,
 * 하나는 Disconnected 인 채 끝나 에이전트 결과가 러너 연결 끊김인 런이다.
 */
function addRunsOnOfflineRunner(db: Database): void {
  const runnerB = toRunnerId("runner-b");
  for (const [key, end] of [
    ["ACME-20", false],
    ["ACME-21", true],
  ] as const) {
    const assigned = assignRun(db, {
      ticket: { connection, key: toTicketKey(key) },
      trackerProject: toTrackerProjectId("tp-web"),
      runnerProject: toRunnerProjectId("github:acme/lab"),
      agent: toAgentId("claude"),
      runnerId: runnerB,
      now: minutes(60),
    });
    if (!assigned.ok) throw new Error(assigned.reason);
    const id = assigned.run.id;
    const steps = [
      { to: "running", started: startedOn(`wt-${key}`) },
      { to: "disconnected" },
      ...(end
        ? [{ to: "ended", agentResult: "runner-disconnected", prState: "none" } as const]
        : []),
    ] as const;
    for (const [i, step] of steps.entries()) {
      if (!changeRunState(db, id, step, minutes(61 + i)).ok) throw new Error(`${key} ${step.to}`);
    }
  }
}

describe("loadRunnersPage", () => {
  it("러너를 등록한 순서로 담고 Online/Offline 과 마지막 확인부터 지난 시간을 담는다", () => {
    const { db } = seedDatabase();
    const page = loadRunnersPage(db, now);
    expect(page.runners.map((r) => [r.name, r.online, r.checked?.agoMs ?? null])).toEqual([
      ["runner-a", true, 120 * 60_000],
      ["runner-b", false, 120 * 60_000],
    ]);
  });

  it("capacity 사용량은 Running·Waiting for Input·Disconnected 런을 센다(Q74)", () => {
    const { db } = seedDatabase();
    const a = runner(db, "runner-a");
    expect(a.capacity).toBe(10);
    expect(keys(a.occupying).toSorted()).toEqual(["ACME-10", "ACME-11", "ACME-12", "LAB-1"]);
    expect(a.occupying.find((run) => run.ticketKey === "ACME-12")?.state).toBe("disconnected");
    // Queued 와 Ended 런은 capacity 를 쓰지 않는다
    expect(keys(a.queued)).toEqual(["ACME-13"]);
  });

  it("Offline 러너의 Disconnected 런도 capacity 를 차지한다(Q74)", () => {
    const { db } = seedDatabase();
    addRunsOnOfflineRunner(db);
    const b = runner(db, "runner-b");
    expect(b.online).toBe(false);
    expect(keys(b.occupying)).toEqual(["ACME-20"]);
    expect(b.occupying[0]?.state).toBe("disconnected");
  });

  it("남은 워크트리는 PR 이 정해질 때까지 남기거나 사람이 정할 Ended 런이다(Q44·Q51·Q75·Q77)", () => {
    const { db } = seedDatabase();
    addRunsOnOfflineRunner(db);
    // ACME-2: 완료 보고(실패) · PR 열림 → PR 이 정해질 때까지 남김
    // ACME-5: 러너 연결 끊김 → 사람이 정함. 그 밖의 Ended 런은 바로 지우거나 지울 것이 없다
    expect(runner(db, "runner-a").leftWorktrees.map((w) => [w.ticketKey, w.worktree])).toEqual([
      ["ACME-2", "keep-until-pr-settles"],
      ["ACME-5", "operator-decides"],
    ]);
    // 러너 연결 끊김 런은 Offline 러너에도 남는다
    expect(runner(db, "runner-b").leftWorktrees.map((w) => [w.ticketKey, w.worktree])).toEqual([
      ["ACME-21", "operator-decides"],
    ]);
  });

  it("러너에 닿지 못한 채 끝난 취소 런은 사람이 정할 남은 워크트리로 센다(Q82.21)", () => {
    const { db } = seedDatabase();
    addUnreachedCanceledRun(db, "ACME-22");
    expect(runner(db, "runner-b").leftWorktrees.map((w) => [w.ticketKey, w.worktree])).toEqual([
      ["ACME-22", "operator-decides"],
    ]);
  });

  it("GitHub 인증이 깨진 러너는 할당에서 빠졌다고 담고 프로젝트별 결과를 담는다(Q82.14·Q82.15)", () => {
    const { db } = seedDatabase();
    expect(runner(db, "runner-a")).toMatchObject({ assignmentBlocked: false, checks: null });
    breakGitHubAuth(db);
    const a = runner(db, "runner-a");
    expect(a.online).toBe(true);
    expect(a.assignmentBlocked).toBe(true);
    // 할당을 막지 않는 필수 조건(상시 서비스)도 확인 항목으로 담는다
    expect(a.checks).toEqual([
      {
        id: "service",
        name: "Orca service",
        project: null,
        satisfied: true,
        blocksAssignment: false,
        hint: null,
      },
      {
        id: "github-push:github:acme/web",
        name: "GitHub push access: acme/web",
        project: "github:acme/web",
        satisfied: false,
        blocksAssignment: true,
        // GitHub push 의 해결 방법은 화면 메시지로 보여 어댑터 안내를 담지 않는다
        hint: null,
      },
      {
        id: "github-push:github:acme/docs",
        name: "GitHub push access: acme/docs",
        // runner-a 의 러너 쪽 프로젝트에 없다
        project: null,
        satisfied: true,
        blocksAssignment: true,
        hint: null,
      },
    ]);
  });

  it("지운 시각이 있는 워크트리는 세지 않는다(Q75)", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-5");
    if (id === undefined) throw new Error("seed");
    updateRunRecords(db, id, { worktreeRemovedAt: now });
    expect(keys(runner(db, "runner-a").leftWorktrees)).toEqual(["ACME-2"]);
  });

  it("런마다 Workspace 를 담는다", () => {
    const { db } = seedDatabase();
    const workspaces = new Map(
      runner(db, "runner-a").occupying.map((run) => [run.ticketKey, run.workspace.name]),
    );
    expect(workspaces.get("ACME-10")).toBe("Acme Commerce");
    expect(workspaces.get("LAB-1")).toBe("Acme Labs");
  });

  it("러너 설정의 ssh 대상을 보이고, 없거나 모양이 다르면 비운다", () => {
    const { db } = seedDatabase();
    expect(runner(db, "runner-a")).toMatchObject({ sshTarget: null });
    saveRunner(db, {
      id: toRunnerId("runner-a"),
      kind: toRunnerKind("fake"),
      name: "runner-a",
      config: { sshTarget: "factory@runner-a.example.com", orcaPath: "/usr/local/bin/orca" },
      capacity: 10,
    });
    expect(runner(db, "runner-a")).toMatchObject({ sshTarget: "factory@runner-a.example.com" });
    saveRunner(db, {
      id: toRunnerId("runner-a"),
      kind: toRunnerKind("fake"),
      name: "runner-a",
      config: { sshTarget: 3 },
      capacity: 10,
    });
    expect(runner(db, "runner-a")).toMatchObject({ sshTarget: null });
  });
});

describe("Workspace 범위(ADR 0006)", () => {
  it("러너는 Workspace 밖 자원이라 모든 Workspace 의 런을 한 목록에 담는다", () => {
    const { db } = seedDatabase();
    const page = loadRunnersPage(db, now);
    const all = page.runners.flatMap((r) => [...r.occupying, ...r.queued, ...r.leftWorktrees]);
    expect(new Set(all.map((run) => run.workspace.id))).toEqual(
      new Set(["ws-commerce", "ws-labs"]),
    );
  });

  it("라우트 loader 는 ws 에 기대지 않아 Workspace 를 바꿔도 같은 러너 목록을 보인다", () => {
    // ws 가 loaderDeps 에 없으면 Workspace 를 바꿔도 같은 loader 결과를 쓴다(Runs 는 ws 를 deps 로 둔다).
    expect(Route.options.loaderDeps).toBeUndefined();
    // 화면에 다시 들어오면 새로 읽고, 머무는 동안(행 고르기, Workspace 바꾸기)은 다시 읽지 않는다
    expect(Route.options.shouldReload).toBe(reloadOnEnter);
    expect(reloadOnEnter({ cause: "enter" })).toBe(true);
    expect(reloadOnEnter({ cause: "stay" })).toBe(false);
  });
});

/** 시작한 런이 러너에서 받는 값(워크트리, 실제 브랜치, 에이전트 참조) */
function startedOn(worktree: string) {
  return {
    worktree: toWorktreeRef(worktree),
    branch: `acme/${worktree}`,
    agentRef: toAgentRef(`agent-${worktree}`),
  };
}
