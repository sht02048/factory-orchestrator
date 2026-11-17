import { completeLogTailRequest, updateRunRecords } from "@factory/db";
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
  it("Ended 런은 에이전트 결과와 PR 상태를 각각 보이고 요약 결과는 계산 표대로다", () => {
    const { db, ids } = seedDatabase();
    for (const c of endedCases) {
      const body = text(render(page(db, ids.get(c.key))));
      expect({ key: c.key, agent: body.includes(domain.agentResult[c.agentResult]) }).toEqual({
        key: c.key,
        agent: true,
      });
      expect(body).toContain(domain.prState[c.prState]);
      expect(body).toContain(domain.summary[c.summary]);
      expect(body).toContain(runJson.reason[c.summary]);
    }
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
    const running = found(db, ids.get("ACME-10"));
    const pending = render({ kind: "found", run: { ...running, cancelPending: true } });
    expect(pending).toContain(runJson.cancelPending);
    expect(pending).not.toContain(runJson.cancel.trigger);
  });

  it("질문으로 기다리는 런은 질문 내용, 선택지, 답하기 칸을 보인다", () => {
    const { db, ids } = seedDatabase();
    const run = found(db, ids.get("ACME-11"));
    const html = render({
      kind: "found",
      run: {
        ...run,
        status: {
          state: "waiting-for-input",
          input: {
            kind: "question",
            questionId: "q-1",
            body: "마이그레이션을 지금 돌릴까요?",
            choices: ["돌려 주세요", "멈춰 주세요"],
            askedAt: minutes(50).toISOString(),
          },
        },
      },
    });
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
    const run = found(db, ids.get("ACME-11"));
    const body = text(
      render({
        kind: "found",
        run: {
          ...run,
          status: {
            state: "waiting-for-input",
            input: { kind: "permission", since: minutes(50).toISOString() },
          },
        },
      }),
    );
    expect(body).toContain(runJson.permission.body);
    expect(body).toContain(runJson.permission.deny);
    expect(body).not.toContain("허용하기");
    expect(body).not.toContain(runJson.question.submit);
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
