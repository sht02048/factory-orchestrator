import { toAgentId, toLabelId, toRunId, toRunnerId, toRunnerProjectId } from "@ganger/core";
import { getRun, recordRunnerCheck, replaceMapping } from "@ganger/db";
import { describe, expect, it } from "vitest";
import { TICKET_TITLE_MAX_LENGTH } from "@ganger/db";
import { assignInput, submitAssignment } from "@ganger/app/tickets/assign";
import type { AssignInput } from "@ganger/app/tickets/assign";
import { loadTicketsPage } from "@ganger/app/tickets/load";
import { firstAssignableRepo, repoReach } from "@ganger/app/tickets/model";
import { connection, docsProject, now, setupTickets, webProject, webRepo } from "./test-fixtures";

const base: AssignInput = {
  connection,
  ticketKey: "ACME-6",
  ticketTitle: "Checkout retry",
  trackerProject: webProject,
  runnerProject: webRepo,
  runnerId: null,
  agent: "claude",
};

function assignedRun(
  db: Parameters<typeof getRun>[0],
  result: ReturnType<typeof submitAssignment>,
) {
  if (!result.ok) throw new Error(`assign failed: ${result.reason}`);
  const run = getRun(db, toRunId(result.runId));
  if (run === null) throw new Error("run not saved");
  return run;
}

describe("수동 할당", () => {
  it("Mapping 기본값 그대로 할당하면 러너를 자동으로 골라 Queued 런을 만든다", () => {
    const { db } = setupTickets();
    const run = assignedRun(db, submitAssignment(db, base, now));
    expect(run).toMatchObject({
      state: "queued",
      ticket: { connection: "conn-acme", key: "ACME-6" },
      trackerProject: "tp-web",
      runnerProject: "github:acme/web",
      agent: "claude",
      runnerId: "runner-a",
      assignedAt: now,
    });
  });

  it("Tickets 화면이 트래커에서 읽은 제목을 앞뒤 공백 없이 런에 저장한다(0064)", () => {
    const { db } = setupTickets();
    const parsed = assignInput.parse({ ...base, ticketTitle: "  결제 실패 재시도  " });
    expect(assignedRun(db, submitAssignment(db, parsed, now)).ticketTitle).toBe("결제 실패 재시도");
  });

  it("빈 제목은 비워 두고, 상한보다 긴 제목은 받지 않는다(0064)", () => {
    const { db } = setupTickets();
    const blank = assignInput.parse({ ...base, ticketTitle: "   " });
    expect(assignedRun(db, submitAssignment(db, blank, now)).ticketTitle).toBeNull();
    expect(
      assignInput.safeParse({ ...base, ticketTitle: "가".repeat(TICKET_TITLE_MAX_LENGTH + 1) })
        .success,
    ).toBe(false);
    expect(
      assignInput.safeParse({ ...base, ticketTitle: "가".repeat(TICKET_TITLE_MAX_LENGTH) }).success,
    ).toBe(true);
  });

  it("제목을 보내지 않는 옛 화면의 할당도 받고 제목은 비워 둔다(0064)", () => {
    const { db } = setupTickets();
    const { ticketTitle: _omitted, ...withoutTitle } = base;
    const parsed = assignInput.parse(withoutTitle);
    expect(assignedRun(db, submitAssignment(db, parsed, now)).ticketTitle).toBeNull();
  });

  it("러너와 에이전트를 바꿔 할당한 값이 런에 저장된다", () => {
    const { db } = setupTickets();
    const run = assignedRun(
      db,
      submitAssignment(db, { ...base, runnerId: "runner-b", agent: "codex" }, now),
    );
    expect(run).toMatchObject({
      runnerId: "runner-b",
      agent: "codex",
      runnerProject: "github:acme/web",
    });
  });

  it("Mapping 의 모델을 런에 적고, 에이전트를 바꾸면 모델을 넘기지 않는다(0043)", () => {
    const { db } = setupTickets();
    expect(assignedRun(db, submitAssignment(db, base, now)).model).toBe("sonnet");
    const changed = assignedRun(
      db,
      submitAssignment(db, { ...base, ticketKey: "ACME-7", agent: "codex" }, now),
    );
    expect(changed).toMatchObject({ agent: "codex", model: null });
    expect(assignInput.parse({ ...base, model: "opus" })).not.toHaveProperty("model");
  });

  it("Mapping에 없는 저장소로는 할당하지 않는다(0115)", () => {
    const { db } = setupTickets();
    expect(submitAssignment(db, { ...base, runnerProject: "github:acme/lab" }, now)).toEqual({
      ok: false,
      reason: "unknown-repo",
    });
  });

  it("진행 중이거나 Queued 인 런이 있는 티켓은 할당하지 않는다", () => {
    const { db } = setupTickets();
    for (const key of ["ACME-3", "ACME-4", "ACME-5"]) {
      expect(submitAssignment(db, { ...base, ticketKey: key }, now)).toEqual({
        ok: false,
        reason: "active-run",
      });
    }
    expect(submitAssignment(db, base, now).ok).toBe(true);
    expect(submitAssignment(db, base, now)).toEqual({ ok: false, reason: "active-run" });
  });

  it("GitHub 인증이 깨진 러너는 고를 수 없다(Q87)", () => {
    const { db } = setupTickets();
    expect(submitAssignment(db, { ...base, runnerId: "runner-c" }, now)).toEqual({
      ok: false,
      reason: "runner-assignment-blocked",
    });
  });

  it("그 러너 쪽 프로젝트가 없는 러너, 모르는 에이전트, Mapping 없는 프로젝트는 막는다", () => {
    const { db } = setupTickets();
    expect(submitAssignment(db, { ...base, runnerId: "runner-d" }, now)).toEqual({
      ok: false,
      reason: "unknown-runner",
    });
    expect(submitAssignment(db, { ...base, runnerId: "runner-x" }, now)).toEqual({
      ok: false,
      reason: "unknown-runner",
    });
    expect(submitAssignment(db, { ...base, agent: "gemini" }, now)).toEqual({
      ok: false,
      reason: "unknown-agent",
    });
    expect(
      submitAssignment(db, { ...base, ticketKey: "DOC-1", trackerProject: docsProject }, now),
    ).toEqual({ ok: false, reason: "no-mapping" });
  });
});

describe("여러 저장소 수동 할당(0115)", () => {
  const apiRepo = toRunnerProjectId("github:acme/api");
  const bug = toLabelId("label-bug");

  function withApiRepo() {
    const fixture = setupTickets();
    replaceMapping(fixture.db, {
      connection,
      trackerProject: webProject,
      agent: toAgentId("claude"),
      model: "sonnet",
      repos: [
        { project: webRepo, isDefault: true, labelId: null },
        { project: apiRepo, isDefault: false, labelId: bug },
      ],
    });
    return fixture;
  }

  it("할당 창은 티켓 라벨에 맞는 저장소를, 다시 맡길 때는 지난 런의 저장소를 먼저 고른다", async () => {
    const { context } = withApiRepo();
    const page = await loadTicketsPage(context, undefined, now);
    const defaults = (key: string) => {
      const found = page.tickets.find((t) => t.key === key);
      return found?.assignability.kind === "ready" ? found.assignability.defaults : null;
    };
    expect(defaults("ACME-6")).toEqual({
      runnerProject: apiRepo,
      agent: "claude",
      repos: [
        { id: webRepo, isDefault: true, label: null },
        { id: apiRepo, isDefault: false, label: "bug" },
      ],
    });
    expect(defaults("ACME-1")?.runnerProject).toBe(webRepo);
  });

  it("고른 저장소로 런을 만든다", () => {
    const { db } = withApiRepo();
    addApiRunner(db, false);
    const run = assignedRun(db, submitAssignment(db, { ...base, runnerProject: apiRepo }, now));
    expect(run).toMatchObject({ runnerProject: apiRepo, runnerId: "runner-api" });
  });

  it("그 저장소가 있는 러너 모두 push가 막혔으면 할당 창에서 끄고 다음 저장소를 고른다", async () => {
    const { db, context } = withApiRepo();
    addApiRunner(db, true);
    const page = await loadTicketsPage(context, undefined, now);
    expect(repoReach(page.runners, apiRepo)).toEqual({ runners: 1, pushBlockedEverywhere: true });
    expect(repoReach(page.runners, webRepo)).toEqual({ runners: 3, pushBlockedEverywhere: false });
    expect(
      firstAssignableRepo(
        {
          runnerProject: apiRepo,
          agent: "claude",
          repos: [
            { id: webRepo, isDefault: true, label: null },
            { id: apiRepo, isDefault: false, label: "bug" },
          ],
        },
        page.runners,
      ),
    ).toBe(webRepo);
    expect(
      submitAssignment(db, { ...base, runnerProject: apiRepo, runnerId: "runner-api" }, now),
    ).toEqual({ ok: false, reason: "runner-assignment-blocked" });
  });

  function addApiRunner(db: Parameters<typeof getRun>[0], pushBlocked: boolean) {
    const runnerId = toRunnerId("runner-api");
    db.$client
      .prepare(
        "INSERT INTO runners (id, kind, name, config, capacity, online, created_at) VALUES (?, 'fake', 'runner-api', '{}', 2, 1, 0)",
      )
      .run(runnerId);
    recordRunnerCheck(db, {
      runnerId,
      online: true,
      checkedAt: now,
      error: null,
      assignmentBlocked: false,
      projects: [{ id: apiRepo, displayName: apiRepo, setupState: "ready" }],
      prerequisites: [
        {
          id: `push:${apiRepo}`,
          name: "push",
          satisfied: !pushBlocked,
          hint: null,
          blocksAssignment: true,
          project: apiRepo,
        },
      ],
    });
  }
});
