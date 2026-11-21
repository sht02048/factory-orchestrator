import { toPermissionRequestId, toQuestionId, toRunId, toRunnerId } from "@ganger/core";
import {
  changeRunState,
  completeRunControlRequest,
  requestRunControl,
  recordMcpAction,
  completeLogTailRequest,
  recordProviderUsage,
  recordPermissionWaits,
  recordRunQuestions,
  recordStartFailure,
  recordStartRequested,
  saveWorkspaceBrief,
  toWorkspaceId,
  updateRunRecords,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import { describe, expect, it } from "vitest";
import domain from "../../messages/ko/domain.json" with { type: "json" };
import runJson from "../../messages/ko/run.json" with { type: "json" };
import { buttonsOf } from "../testing/buttons";
import { pillsOf } from "../testing/pills";
import { renderWithMessages } from "../testing/render";
import { addTitledRun, endedCases, minutes, now, seedDatabase } from "../testing/seed";
import { loadRunDetail, requestRunLogTail } from "@ganger/app/run-detail/load";
import questionJson from "../../messages/ko/question.json" with { type: "json" };
import { runMessages } from "./messages";
import type { RunDetail, RunDetailPage } from "@ganger/app/run-detail/model";
import { RunDetailScreen } from "./run-detail-screen";
import { addExtraEnded, assign, extraEndedCases, startedOn, walk } from "./testing";
import { answerInput, submitAnswer } from "@ganger/app/home/actions";
import { cancelRunRequest, removeWorktreeRequest } from "@ganger/app/run-detail/actions";

const resolved = () => Promise.resolve();

const labels = (html: string): string[] => buttonsOf(html).map((button) => button.label);

function render(page: RunDetailPage, timeZone?: string): string {
  return renderWithMessages(
    <RunDetailScreen
      page={page}
      runsHref="/runs"
      runHref={(id) => `/runs/${id}`}
      onAnswer={resolved}
      onHumanCheck={resolved}
      onDeny={resolved}
      onCancel={resolved}
      onRemoveWorktree={resolved}
      onControl={() => Promise.resolve("requested" as const)}
      onRefreshLog={resolved}
    />,
    runMessages,
    timeZone,
  );
}

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ");
}

function valueOf(html: string, label: string): string | undefined {
  const after = html.split(`>${label}</dt>`)[1];
  return after === undefined ? undefined : text(after.split("</dd>")[0] ?? "").trim();
}

function page(db: Database, id: string | undefined): RunDetailPage {
  if (id === undefined) throw new Error("no run id");
  return loadRunDetail(db, id, now);
}

function found(db: Database, id: string | undefined): RunDetail {
  const p = page(db, id);
  if (p.kind !== "found") throw new Error("not found");
  return p.run;
}

describe("Run 상세의 받은 지시서 (0146)", () => {
  it("시작한 런은 받은 지시서 전체를 접은 채로 보이고, 줄바꿈을 그대로 둔다", () => {
    const { db } = seedDatabase();
    const id = assign(db, "ACME-90", 900);
    const brief = "Read AGENTS.md first.\n\nACME-90 Fix totals\n\n## 운영자에게 물을 때\n";
    recordStartRequested(db, id, minutes(900), brief);
    walk(db, id, 900, [startedOn("ACME-90")]);
    const html = render(page(db, id));
    const details = html.slice(html.indexOf("<details"), html.indexOf("</details>"));
    expect(details).not.toContain(" open");
    expect(text(details)).toContain(runJson.brief.title);
    expect(details).toContain(`aria-label="${runJson.brief.label}"`);
    expect(details).toContain("Read AGENTS.md first.\n\nACME-90 Fix totals");
  });

  it("Workspace 지시를 바꿔도 이미 시작한 런의 받은 지시서는 그대로다", () => {
    const { db } = seedDatabase();
    const id = assign(db, "ACME-91", 910);
    recordStartRequested(db, id, minutes(910), "Old rule.\n\nACME-91\n");
    walk(db, id, 910, [startedOn("ACME-91")]);
    saveWorkspaceBrief(db, {
      id: toWorkspaceId(found(db, id).workspace.id),
      brief: { before: "New rule.", after: "" },
    });
    expect(found(db, id).brief).toBe("Old rule.\n\nACME-91\n");
  });

  it("지시서를 보내기 전이거나 시작하지 못한 런에는 받은 지시서 구역이 없다", () => {
    const { db } = seedDatabase();
    const id = assign(db, "ACME-92", 920);
    recordStartRequested(db, id, minutes(920), "never received");
    expect(found(db, id).brief).toBeNull();
    walk(db, id, 920, [{ to: "ended", agentResult: "could-not-start", prState: "none" }]);
    expect(found(db, id).brief).toBeNull();
    expect(render(page(db, id))).not.toContain(runJson.brief.title);
  });
});

describe("Run 상세 화면", () => {
  it("에이전트 결과 아홉과 PR 상태 넷이 각각의 칸에, 요약 결과(Canceled 포함)가 계산 표대로 보인다", () => {
    const { db, ids } = seedDatabase();
    const extra = addExtraEnded(db);
    const cases = [
      ...endedCases.map((c) => ({ ...c, id: ids.get(c.key) })),
      ...extraEndedCases.map((c) => ({ ...c, id: extra.get(c.key) })),
    ];
    for (const c of cases) {
      const html = render(page(db, c.id));
      expect({
        key: c.key,
        agent: valueOf(html, runJson.props.agentResult),
        pr: valueOf(html, runJson.props.prState),
        summary: text(html).includes(domain.summary[c.summary]),
        reason: text(html).includes(runJson.reason[c.summary]),
      }).toEqual({
        key: c.key,
        agent: domain.agentResult[c.agentResult],
        pr: domain.prState[c.prState],
        summary: true,
        reason: true,
      });
    }
  });

  it.each(["no-access", "other"] as const)(
    "PR 정보를 읽지 못한 런(%s)은 못 읽음과 이유, 할 일을 보인다 (0144)",
    (reason) => {
      const { db } = seedDatabase();
      const id = assign(db, "ACME-40", 400);
      walk(db, id, 400, [
        startedOn("ACME-40"),
        {
          to: "ended",
          agentResult: "reported-success",
          prState: "unknown",
          prReadError: reason,
        },
      ]);
      expect(found(db, id).status).toMatchObject({ prState: "unknown", prReadError: reason });
      const html = render(page(db, id));
      expect(valueOf(html, runJson.props.prState)).toBe(
        `${domain.prState.unknown} ${runJson.props.prUnreadReason[reason]}`,
      );
      const body = text(html);
      expect(body).toContain(`${runJson.prUnread.title} ${runJson.prUnread[reason]}`);
      expect(body).toContain(runJson.reason.succeeded);
      expect(body).toContain(`${domain.summary.succeeded} PR ${domain.prState.unknown}`);
      expect(pillsOf(html).map((pill) => pill.label)).toEqual([domain.summary.succeeded]);
    },
  );

  it("제목은 할당 때 저장한 티켓 제목이고, 회색 줄에 키를 함께 보인다(ADR 0010 9번, 0064)", () => {
    const { db } = seedDatabase();
    const html = render(page(db, addTitledRun(db, "ACME-30", "결제 실패 재시도")));
    expect(html).toMatch(/<h1[^>]*>결제 실패 재시도<\/h1>/);
    expect(text(html)).toContain("ACME-30 · Web");
  });

  it("제목을 모르는 런은 키를 제목으로 보인다", () => {
    const { db, ids } = seedDatabase();
    expect(render(page(db, ids.get("ACME-2")))).toMatch(/<h1[^>]*>ACME-2<\/h1>/);
  });

  it("에이전트는 ID 대신 공용 에이전트 이름으로 보인다", () => {
    const { db, ids } = seedDatabase();
    expect(valueOf(render(page(db, ids.get("ACME-2"))), runJson.props.agent)).toBe("Claude Code");
  });

  it("런에 적은 모델을 보이고, 정하지 않았으면 러너 기본값을 쓴다고 보인다(0043)", () => {
    const { db, ids } = seedDatabase();
    expect(valueOf(render(page(db, ids.get("ACME-2"))), runJson.props.model)).toBe(
      runJson.props.defaultModel,
    );
    const id = assign(db, "ACME-90", 500, "sonnet");
    expect(valueOf(render(page(db, id)), runJson.props.model)).toBe("sonnet");
  });

  it("러너에 닿지 못한 채 끝난 취소 런은 워크트리를 남긴 이유와 지우기 버튼을 보인다", () => {
    const { db } = seedDatabase();
    const extra = addExtraEnded(db);
    const kept = render(page(db, extra.get("ACME-22")));
    expect(text(kept)).toContain(runJson.keptWorktree["runner-unreached"]);
    expect(labels(kept)).toContain(runJson.removeWorktree.trigger);
    const removed = render(page(db, extra.get("ACME-21")));
    expect(text(removed)).not.toContain(runJson.keptWorktree["runner-unreached"]);
    expect(labels(removed)).not.toContain(runJson.removeWorktree.trigger);
  });

  it("결과 곁에 PR 번호와 지금 PR 상태를 보이고, 이후 PR 상태가 있으면 그것을 보인다 (0145)", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-2");
    if (id === undefined) throw new Error("no ACME-2");
    const stateLine = (): string => text(render(page(db, id)));
    expect(stateLine()).toContain(`${domain.summary.failed} PR #2 ${domain.prState.open}`);
    updateRunRecords(db, id, { laterPrState: { state: "merged", at: minutes(110) } });
    expect(stateLine()).toContain(`${domain.summary.failed} PR #2 ${domain.prState.merged}`);
    const noPr = text(render(page(db, ids.get("ACME-4"))));
    expect(noPr).not.toContain(`${domain.summary.failed} PR `);
  });

  it("Succeeded 인데 PR 이 없으면 워크트리를 남겼다고 보이고 워크트리 지우기를 둔다 (0145 R7-2·R7-3)", () => {
    const { db } = seedDatabase();
    const id = assign(db, "ACME-41", 400);
    walk(db, id, 400, [
      startedOn("ACME-41"),
      { to: "ended", agentResult: "reported-success", prState: "none" },
    ]);
    const html = render(page(db, id));
    const body = text(html);
    expect(body).toContain(`${runJson.keptWorktree["no-pr"]} ${runJson.keptWorktreeNext["no-pr"]}`);
    expect(body).not.toContain(runJson.next.succeeded);
    expect(labels(html)).toContain(runJson.removeWorktree.trigger);
    expect(html).toMatch(/data-variant="danger"[^>]*>워크트리 지우기|워크트리 지우기/);
  });

  it.each(["uncommitted-changes", "unpushed-commits", "check-failed"] as const)(
    "worker 가 일이 남아 남긴 워크트리(%s)는 그 이유를 보인다 (0145 R7-1)",
    (reason) => {
      const { db, ids } = seedDatabase();
      const id = ids.get("ACME-3");
      if (id === undefined) throw new Error("no ACME-3");
      updateRunRecords(db, id, { worktreeKept: reason });
      const html = render(page(db, id));
      expect(text(html)).toContain(
        `${runJson.keptWorktree[reason]} ${runJson.keptWorktreeNext[reason]}`,
      );
      expect(labels(html)).toContain(runJson.removeWorktree.trigger);
    },
  );

  it("워크트리 지우기를 요청하면 버튼 대신 지우는 중을 상태 문장으로 보인다 (0145 R7-3)", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-3");
    if (id === undefined) throw new Error("no ACME-3");
    updateRunRecords(db, id, { worktreeKept: "unpushed-commits" });
    removeWorktreeRequest(db, id, minutes(110));
    const html = render(page(db, id));
    expect(labels(html)).not.toContain(runJson.removeWorktree.trigger);
    expect(html).toMatch(new RegExp(`role="status"[^>]*>${runJson.removeWorktree.pending}<`));
  });

  it("시작하지 않고 끝난 런은 0초 만에 끝났다고 하지 않는다", () => {
    const { db } = seedDatabase();
    const extra = addExtraEnded(db);
    const body = text(render(page(db, extra.get("ACME-23"))));
    expect(body).toContain("시작하지 않고 1분 기다린 뒤 끝났어요");
    expect(body).not.toContain("만에 끝났어요");
  });

  it("시작할 수 없음 런은 시작 오류를 보인다", () => {
    const { db } = seedDatabase();
    const id = assign(db, "ACME-30", 60);
    recordStartFailure(db, id, { failures: 3, error: "worker-start: project not found" });
    walk(db, id, 60, [{ to: "ended", agentResult: "could-not-start", prState: "none" }]);
    const body = text(render(page(db, id)));
    expect(body).toContain(runJson.startError.title);
    expect(body).toContain("worker-start: project not found");
  });

  it("Disconnected 런은 연결 끊김과 ssh 가 실패하기 시작한 시각을 보인다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-12");
    if (id === undefined) throw new Error("no ACME-12");
    updateRunRecords(db, id, { unreachableSince: minutes(40) });
    const body = text(render(page(db, id)));
    expect(body).toContain(domain.runState.disconnected);
    expect(body).toContain("09:40부터 러너에 닿지 않아요");
    expect(body).toContain(runJson.timeline.unreachable);
  });

  it("같은 런의 타임라인 시각을 운영자 시간대로 보인다(0044)", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-12");
    if (id === undefined) throw new Error("no ACME-12");
    updateRunRecords(db, id, { unreachableSince: minutes(40) });
    const detail = page(db, id);
    expect(text(render(detail))).toContain("09:40부터 러너에 닿지 않아요");
    expect(text(render(detail, "Asia/Seoul"))).toContain("18:40부터 러너에 닿지 않아요");
    expect(text(render(detail, "America/Los_Angeles"))).toContain("01:40부터 러너에 닿지 않아요");
  });

  it("워크트리를 지우지 않은 러너 연결 끊김 런은 워크트리를 남긴 이유와 지우기 버튼을 보인다", () => {
    const { db, ids } = seedDatabase();
    const html = render(page(db, ids.get("ACME-5")));
    expect(text(html)).toContain(
      `${runJson.keptWorktree["runner-disconnected"]} ${runJson.keptWorktreeNext["runner-disconnected"]}`,
    );
    expect(labels(html)).toContain(runJson.removeWorktree.trigger);
    const removed = render(page(db, ids.get("ACME-3")));
    expect(text(removed)).not.toContain(runJson.keptWorktree["runner-disconnected"]);
    expect(labels(removed)).not.toContain(runJson.removeWorktree.trigger);
  });

  it("Ended 가 아닌 런에서만 취소 행동이 보이고, 취소 요청이 있으면 취소 중을 보인다", () => {
    const { db, ids } = seedDatabase();
    for (const key of ["ACME-10", "ACME-11", "ACME-12", "ACME-13"]) {
      expect({
        key,
        cancel: render(page(db, ids.get(key))).includes(runJson.cancel.trigger),
      }).toEqual({ key, cancel: true });
    }
    for (const c of endedCases) {
      expect(render(page(db, ids.get(c.key)))).not.toContain(runJson.cancel.trigger);
    }
    const running = ids.get("ACME-10");
    if (running === undefined) throw new Error("no ACME-10");
    expect(cancelRunRequest(db, running, minutes(100))).toEqual({ ok: true });
    const pending = render(page(db, running));
    expect(pending).toContain(runJson.cancelPending);
    expect(pending).not.toContain(runJson.cancel.trigger);
  });

  it("Running 런은 멈추기, 요청 중이면 멈추는 중, 실패하면 이유를 알림 역할 없이 보인다(0118)", () => {
    const { db, ids } = seedDatabase();
    const running = ids.get("ACME-10");
    if (running === undefined) throw new Error("no ACME-10");
    expect(labels(render(page(db, running)))).toContain(runJson.control.pause);

    expect(requestRunControl(db, running, "pause", minutes(100))).toMatchObject({ ok: true });
    const pending = render(page(db, running));
    expect(text(pending)).toContain(runJson.control.pausePending);
    expect(labels(pending)).not.toContain(runJson.control.pause);

    completeRunControlRequest(db, {
      runId: running,
      requestedAt: minutes(100),
      completedAt: minutes(115),
      error: "runner-unreachable",
    });
    const failed = render(page(db, running));
    const reason = runJson.control.pauseFailed.replace(
      "{reason}",
      domain.runControlFailure["runner-unreachable"],
    );
    expect(text(failed)).toContain(reason);
    expect(failed).not.toMatch(/role="alert"[^>]*>[^<]*멈추지 못했어요/);
    expect(labels(failed)).toContain(runJson.control.pause);

    const later = loadRunDetail(db, running, minutes(126));
    expect(later.kind === "found" ? later.run.control : "missing").toBeNull();
  });

  it("러너에서 멈춘 런과 보고 없이 멈춘 런은 이유를 다르게 보이고, 보고 없이 멈추면 마지막 출력을 접지 않고 보인다(0120)", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-10");
    if (id === undefined) throw new Error("no ACME-10");
    expect(changeRunState(db, id, { to: "paused", source: "runner" }, minutes(90))).toMatchObject({
      ok: true,
    });
    const onRunner = text(render(page(db, id)));
    expect(onRunner).toContain(
      runJson.reason.paused.replace("{source}", domain.pauseSource.runner),
    );
    expect(onRunner).not.toContain(runJson.lastOutput.title);

    expect(changeRunState(db, id, { to: "running" }, minutes(95))).toMatchObject({ ok: true });
    expect(
      changeRunState(db, id, { to: "paused", source: "unreported" }, minutes(100)),
    ).toMatchObject({ ok: true });
    updateRunRecords(db, id, { lastLog: ["로그인 버튼을 고쳤어요", "❯"] });
    const detail = found(db, id);
    expect(detail.status).toMatchObject({
      state: "paused",
      pauseSource: "unreported",
      lastOutput: ["로그인 버튼을 고쳤어요", "❯"],
    });
    const html = render(page(db, id));
    expect(text(html)).toContain(
      runJson.reason.paused.replace("{source}", domain.pauseSource.unreported),
    );
    expect(text(html)).toContain(runJson.lastOutput.title);
    expect(text(html)).toContain("로그인 버튼을 고쳤어요");
    expect(html).not.toContain("<details");

    updateRunRecords(db, id, { lastLog: null });
    expect(text(render(page(db, id)))).toContain(runJson.lastOutput.none);
  });

  it("Paused 런은 Paused 알약, 멈춘 시간, 재개하기를 보이고 실행 시간에서 멈춘 시간을 뺀다(0118)", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-10");
    if (id === undefined) throw new Error("no ACME-10");
    const before = found(db, id).executionMs ?? 0;
    expect(changeRunState(db, id, { to: "paused" }, minutes(90))).toMatchObject({ ok: true });
    const detail = found(db, id);
    expect(detail.status.state).toBe("paused");
    const html = render(page(db, id));
    expect(pillsOf(html)).toContainEqual({ status: "paused", label: domain.runState.paused });
    expect(buttonsOf(html)).toContainEqual({ variant: "primary", label: runJson.control.resume });
    expect(labels(html)).not.toContain(runJson.control.pause);
    expect(text(html)).toContain(runJson.next.paused);
    expect(text(html)).toContain(
      runJson.reason.paused.replace("{source}", domain.pauseSource.operator),
    );
    expect(text(html)).toContain(runJson.timeline.paused);
    expect(detail.executionMs).toBe(before - 30 * 60_000);

    expect(changeRunState(db, id, { to: "disconnected" }, minutes(110))).toMatchObject({
      ok: true,
    });
    const offline = text(render(page(db, id)));
    expect(offline).toContain(runJson.reason.disconnectedPaused);
    expect(offline).not.toContain(runJson.reason.disconnected);
  });

  it("질문으로 기다리는 런은 질문 내용, 선택지, 답하기 칸을 보인다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-11");
    if (id === undefined) throw new Error("no ACME-11");
    recordRunQuestions(db, id, [
      {
        id: toQuestionId("q-1"),
        body: "마이그레이션을 지금 돌릴까요?",
        options: ["돌려 주세요", "멈춰 주세요"],
        askedAt: minutes(50),
      },
    ]);
    const html = render(page(db, id));
    const body = text(html);
    expect(body).toContain("마이그레이션을 지금 돌릴까요?");
    expect(body).toContain("돌려 주세요");
    expect(body).toContain(questionJson.send);
    expect(html).toMatch(/<input type="radio"[^>]*value="0"/);
    expect(body).toContain(runJson.next.question);
    expect(body).not.toContain(runJson.permission.deny);
  });

  it("권한 대기 런은 러너 화면에서 허용하라고 안내하고 거절만 둔다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-11");
    if (id === undefined) throw new Error("no ACME-11");
    recordPermissionWaits(db, id, [
      {
        id: toPermissionRequestId("perm-1"),
        detail: "Bash: rm -rf node_modules",
        requestedAt: minutes(50),
      },
    ]);
    const html = render(page(db, id));
    const body = text(html);
    expect(body).toContain("Bash: rm -rf node_modules");
    expect(body).toContain(runJson.permission.body);
    expect(body).toContain(runJson.permission.deny);
    expect(body).not.toContain("허용하기");
    expect(html).not.toMatch(/<button[^>]*>[^<]*허용/);
    expect(body).not.toContain(questionJson.send);
  });

  it("답이나 거절을 남긴 뒤에는 입력 칸을 닫고 worker 가 보낸다고 보인다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-11");
    if (id === undefined) throw new Error("no ACME-11");
    recordRunQuestions(db, id, [
      { id: toQuestionId("q-1"), body: "계속할까요?", options: [], askedAt: minutes(50) },
    ]);
    submitAnswer(
      db,
      answerInput.parse({ runId: id, questionId: "q-1", answer: "네" }),
      minutes(51),
    );
    const html = render(page(db, id));
    expect(html).not.toContain('name="answer"');
    expect(text(html)).toContain(runJson.next.answered);
    expect(html).toMatch(new RegExp(`role="status"[^>]*>${runJson.question.sent}<`));
  });

  it("CI 상태를 볼 수 없으면 그렇게 보이고 요약 결과는 그대로다(Q79)", () => {
    const { db, ids } = seedDatabase();
    const run = found(db, ids.get("ACME-2"));
    if (run.pullRequest === null) throw new Error("no PR");
    const body = text(
      render({
        kind: "found",
        run: { ...run, pullRequest: { ...run.pullRequest, ci: "unavailable" } },
      }),
    );
    expect(body).toContain(runJson.ci.unavailable);
    expect(body).toContain(domain.summary.failed);
  });

  it("로그 꼬리: 폴링이 끝나도 로그가 오지 않았으면 가져오는 중 대신 다시 요청하는 길을 보인다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-10");
    if (id === undefined) throw new Error("no ACME-10");
    requestRunLogTail(db, id, minutes(100));
    const html = renderWithMessages(
      <RunDetailScreen
        page={page(db, id)}
        runsHref="/runs"
        runHref={(other) => `/runs/${other}`}
        logStalled
        onAnswer={resolved}
        onHumanCheck={resolved}
        onDeny={resolved}
        onCancel={resolved}
        onRemoveWorktree={resolved}
        onControl={() => Promise.resolve("requested" as const)}
        onRefreshLog={resolved}
      />,
      runMessages,
    );
    const body = text(html);

    expect(html).toMatch(new RegExp(`role="status"[^>]*>${runJson.log.stalled}<`));
    expect(body).toContain(runJson.log.stalled);
    expect(body).not.toContain(runJson.log.pending);
    expect(body).toContain(runJson.log.refresh);
  });

  it("로그 꼬리: 요청 중이면 가져오는 중을, 결과가 들어오면 그 줄을 보인다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-10");
    if (id === undefined) throw new Error("no ACME-10");
    requestRunLogTail(db, id, minutes(100));
    expect(text(render(page(db, id)))).toContain(runJson.log.pending);
    completeLogTailRequest(db, {
      runId: id,
      requestedAt: minutes(100),
      completedAt: minutes(101),
      lines: ["$ pnpm test", "Tests 42 passed"],
    });
    const body = text(render(page(db, id)));
    expect(body).toContain("Tests 42 passed");
    expect(body).not.toContain(runJson.log.pending);
  });

  it("완료 보고 본문과 같은 티켓의 다른 런을 보인다", () => {
    const { db, ids } = seedDatabase();
    const run = found(db, ids.get("ACME-1"));
    const body = text(
      render({
        kind: "found",
        run: {
          ...run,
          report: "PR을 열고 CI 통과를 확인했어요.",
          otherRuns: [
            {
              id: "run-old",
              assignedAt: minutes(0).toISOString(),
              state: "ended",
              summary: "failed",
            },
          ],
        },
      }),
    );
    expect(body).toContain("PR을 열고 CI 통과를 확인했어요.");
    expect(body).toContain(runJson.otherRuns.title);
    expect(body).toContain(domain.summary.failed);
  });

  it("노란 주 버튼은 하나 이하이고, 질문 선택지는 버튼이 아닌 라디오, 런 취소는 위험 버튼이다(ADR 0010 6번)", () => {
    const { db, ids } = seedDatabase();
    const question = ids.get("ACME-11");
    if (question === undefined) throw new Error("no ACME-11");
    recordRunQuestions(db, question, [
      {
        id: toQuestionId("q-1"),
        body: "재시도 간격을 바꿀까요?",
        options: ["지수 백오프", "30초 고정"],
        askedAt: minutes(50),
      },
    ]);
    const html = render(page(db, question));
    const buttons = buttonsOf(html);
    expect(buttons.filter((b) => b.variant === "primary").map((b) => b.label)).toEqual([
      questionJson.send,
    ]);
    for (const choice of ["지수 백오프", "30초 고정"]) {
      expect(buttons.some((b) => b.label === choice)).toBe(false);
      expect(html).toMatch(new RegExp(`<input type="radio"[^>]*>\\s*<span[^>]*>${choice}</span>`));
    }
    expect(buttons.find((b) => b.label === runJson.cancel.trigger)?.variant).toBe("danger");
    expect(buttons.some((b) => b.variant === "other")).toBe(false);

    const extra = addExtraEnded(db);
    for (const id of [...ids.values(), ...extra.values()]) {
      const primaries = buttonsOf(render(page(db, id))).filter((b) => b.variant === "primary");
      expect(primaries.length).toBeLessThanOrEqual(1);
    }
  });

  it("권한 대기의 거절은 위험 버튼이다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-11");
    if (id === undefined) throw new Error("no ACME-11");
    recordPermissionWaits(db, id, [
      { id: toPermissionRequestId("perm-1"), detail: "Bash: ls", requestedAt: minutes(50) },
    ]);
    const buttons = buttonsOf(render(page(db, id)));
    expect(buttons.find((b) => b.label === runJson.permission.deny)?.variant).toBe("danger");
    expect(buttons.filter((b) => b.variant === "primary")).toEqual([]);
  });

  it("맞는 러너가 모두 런의 공급자 한도에 닿으면 대기 사유에 공급자와 풀리는 시간을 보인다", () => {
    const { db } = seedDatabase();
    recordProviderUsage(db, {
      runnerId: toRunnerId("runner-a"),
      readAt: minutes(110),
      reading: {
        kind: "read",
        providers: [
          {
            provider: "claude",
            status: "ok",
            windows: [{ kind: "session", usedPercent: 100, resetsAt: minutes(188) }],
          },
        ],
      },
    });
    const id = assign(db, "ACME-90", 115);

    expect(found(db, id).status).toEqual({
      state: "queued",
      queuedReason: { kind: "usage-limit", provider: "claude", resetsInMs: 68 * 60_000 },
    });
    expect(text(render(page(db, id)))).toContain(
      "모든 러너가 Claude 한도에 닿아 1시간 8분 뒤 풀려요",
    );
  });

  it("상태 알약 글은 GLOSSARY 영어 용어다(ADR 0010 1번)", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-11");
    if (id === undefined) throw new Error("no ACME-11");
    recordRunQuestions(db, id, [
      { id: toQuestionId("q-1"), body: "계속할까요?", options: [], askedAt: minutes(50) },
    ]);
    const terms = new Map<string, string>([
      ["queued", "Queued"],
      ["running", "Running"],
      ["waiting-for-input", "Waiting for Input"],
      ["disconnected", "Disconnected"],
      ["succeeded", "Succeeded"],
      ["failed", "Failed"],
      ["canceled", "Canceled"],
      ["question", "Question"],
      ["permission", "Permission"],
    ]);
    const extra = addExtraEnded(db);
    const pills = [...ids.values(), ...extra.values()].flatMap((runId) =>
      pillsOf(render(page(db, runId))),
    );
    expect(pills.length).toBeGreaterThan(ids.size);
    expect(pills.some((p) => p.status === "question")).toBe(true);
    for (const pill of pills) expect(pill.label).toBe(terms.get(pill.status));
  });

  it("질문 카드에 Question 알약과 답을 기다린 시간을 보인다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-11");
    if (id === undefined) throw new Error("no ACME-11");
    recordRunQuestions(db, id, [
      { id: toQuestionId("q-1"), body: "계속할까요?", options: [], askedAt: minutes(50) },
    ]);
    expect(text(render(page(db, id)))).toContain("Question 1시간 10분째 답을 기다려요");
    recordRunQuestions(db, id, [
      { id: toQuestionId("q-2"), body: "나중 질문", options: [], askedAt: minutes(100) },
    ]);
    const body = text(render(page(db, id)));
    expect(body).toContain("Question 1시간 10분째 답을 기다려요 계속할까요?");
    expect(body).not.toContain("20분째 답을 기다려요");
  });

  it("타임라인은 같은 날이면 시각만, 다른 날이면 날짜를 붙인다", () => {
    const { db, ids } = seedDatabase();
    const run = found(db, ids.get("ACME-10"));
    const body = text(
      render({
        kind: "found",
        run: {
          ...run,
          now: "2026-11-18T03:00:00.000Z",
          timeline: [
            { kind: "assigned", at: "2026-11-17T23:10:00.000Z" },
            { kind: "started", at: "2026-11-18T01:45:00.000Z" },
          ],
        },
      }),
    );
    expect(body).toContain("11월 17일 23:10");
    expect(body).toMatch(/ 01:45 /);
  });

  it("MCP로 한 런 요청은 상태 기록 사이에 MCP · 이름과 도구로 보이고, Operator라고 보내도 MCP가 붙는다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-10");
    if (id === undefined) throw new Error("no ACME-10");
    const runId = toRunId(id);
    const assignedAt = found(db, id).assignedAt;
    recordMcpAction(db, {
      at: new Date(Date.parse(assignedAt) + 1),
      client: "Operator",
      tool: "request_run_log",
      target: "ACME-10",
      runId,
      outcome: "done",
      reason: null,
    });
    recordMcpAction(db, {
      at: new Date(Date.parse(assignedAt) + 2),
      client: "hermes",
      tool: "cancel_run",
      target: "ACME-10",
      runId,
      outcome: "rejected",
      reason: "already-ended",
    });
    const run = found(db, id);
    expect(run.timeline.map((e) => e.kind)).toContain("mcp");
    const body = text(render({ kind: "found", run }));
    expect(body).toContain("MCP · Operator 로그 요청");
    expect(body).toContain("MCP · hermes 런 취소 · 하지 못했어요: 이미 끝난 런이에요");
    expect(body.indexOf("할당")).toBeLessThan(body.indexOf("MCP · Operator"));
  });

  it("없는 런이면 찾을 수 없다고 보인다", () => {
    expect(text(render({ kind: "not-found" }))).toContain(runJson.notFound.title);
  });

  it("문구는 메시지 파일에서 온다", () => {
    const { db, ids } = seedDatabase();
    for (const key of ["ACME-2", "ACME-10", "ACME-12", "ACME-13"]) {
      expect(render(page(db, ids.get(key)))).not.toMatch(/\b(run|domain)\.[a-zA-Z]/);
    }
  });
});
