import { toPermissionRequestId, toQuestionId } from "@factory/core";
import {
  completeLogTailRequest,
  recordPermissionWaits,
  recordRunQuestions,
  recordStartFailure,
  updateRunRecords,
} from "@factory/db";
import type { Database } from "@factory/db";
import { describe, expect, it } from "vitest";
import domain from "../../messages/ko/domain.json" with { type: "json" };
import runJson from "../../messages/ko/run.json" with { type: "json" };
import { renderWithMessages } from "../testing/render";
import { endedCases, minutes, now, seedDatabase } from "../testing/seed";
import { loadRunDetail, requestRunLogTail } from "./load";
import { runMessages } from "./messages";
import type { RunDetail, RunDetailPage } from "./model";
import { RunDetailScreen } from "./run-detail-screen";
import { addExtraEnded, assign, extraEndedCases, walk } from "./testing";
import { answerInput, submitAnswer } from "../home/actions";
import { cancelRunRequest } from "./actions";

const resolved = () => Promise.resolve();

function render(page: RunDetailPage): string {
  return renderWithMessages(
    <RunDetailScreen
      page={page}
      runsHref="/runs"
      runHref={(id) => `/runs/${id}`}
      onAnswer={resolved}
      onDeny={resolved}
      onCancel={resolved}
      onRefreshLog={() => {}}
    />,
    runMessages,
  );
}

/** 태그를 지운 글 */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ");
}

/** 속성 칸 하나의 값(dt 다음 dd 의 글) */
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

  it("러너에 닿지 못한 채 끝난 취소 런도 사람이 지워야 함을 보인다", () => {
    const { db } = seedDatabase();
    const extra = addExtraEnded(db);
    expect(text(render(page(db, extra.get("ACME-22"))))).toContain(runJson.manualRemoval);
    expect(text(render(page(db, extra.get("ACME-21"))))).not.toContain(runJson.manualRemoval);
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
    // T0 + 40분 = 09:40 (UTC)
    expect(body).toContain("09:40부터 러너에 닿지 않아요");
    expect(body).toContain(runJson.timeline.unreachable);
  });

  it("워크트리를 지우지 않은 러너 연결 끊김 런은 사람이 지워야 함을 보이고 지우기 버튼은 없다", () => {
    const { db, ids } = seedDatabase();
    const body = text(render(page(db, ids.get("ACME-5"))));
    expect(body).toContain(runJson.manualRemoval);
    expect(body).toContain(runJson.next.manualRemoval);
    expect(body).not.toContain("지우기");
    expect(text(render(page(db, ids.get("ACME-3"))))).not.toContain(runJson.manualRemoval);
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
    expect(body).toContain(runJson.question.submit);
    expect(html).toContain('name="answer"');
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
    expect(body).not.toContain(runJson.question.submit);
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
    expect(body).toContain(domain.summary["human-check"]);
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
