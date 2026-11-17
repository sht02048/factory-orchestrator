import { describe, expect, it } from "vitest";
import domain from "../../messages/ko/domain.json" with { type: "json" };
import homeJson from "../../messages/ko/home.json" with { type: "json" };
import { renderWithMessages } from "../testing/render";
import { now, offlineQueuedKey, seedDatabase } from "../testing/seed";
import { HomeScreen } from "./home-screen";
import { loadHomePage } from "./load";
import { homeMessages } from "./messages";
import type { HomePage, InputWait } from "./model";

const reject = () => Promise.reject(new Error("unused"));

function render(page: HomePage, selectedKey?: string) {
  return renderWithMessages(
    <HomeScreen
      page={page}
      selectedKey={selectedKey}
      onSelect={() => {}}
      onAnswer={reject}
      onDeny={reject}
    />,
    homeMessages,
  );
}

/** 구역(h2 제목) 하나의 행 글. 행마다 칸을 태그 경계로 나눈다 */
function sectionRows(html: string, title: string): Map<string, string[]> {
  const section = html.split(`>${title}</h2>`)[1]?.split("</section>")[0] ?? "";
  const rows = new Map<string, string[]>();
  for (const chunk of section.split('role="option"').slice(1)) {
    const cells = chunk
      .split(/<[^>]+>/)
      .map((s) => s.trim())
      .filter((s) => s !== "" && !s.includes("="));
    const key = cells[0];
    if (key !== undefined) rows.set(key, cells);
  }
  return rows;
}

function panelText(html: string): string {
  const panel = html.split("<aside")[1] ?? "";
  return panel.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

/** 시드의 입력 기다림 런(ACME-11)에 기다리는 입력을 붙인다 */
function withInput(page: HomePage, input: InputWait): HomePage {
  return {
    ...page,
    attention: page.attention.map((item) =>
      item.kind === "run" &&
      item.run.ticketKey === "ACME-11" &&
      item.run.state === "waiting-for-input"
        ? { ...item, run: { ...item.run, input } }
        : item,
    ),
  };
}

describe("홈 화면", () => {
  it("손댈 일, 실행 중, Queued 세 구역에 런을 나눠 보인다", () => {
    const { db } = seedDatabase();
    const html = render(loadHomePage(db, "ws-commerce", now));
    const attention = sectionRows(html, homeJson.section.attention);
    expect([...attention.keys()]).toContain("ACME-2");
    expect(attention.has("ACME-1")).toBe(false);
    expect([...sectionRows(html, homeJson.section.running).keys()]).toEqual(["ACME-10"]);
    expect([...sectionRows(html, homeJson.section.queued).keys()]).toEqual([
      "ACME-13",
      offlineQueuedKey,
    ]);
    expect(html).toContain(homeJson.section.queuedNote);
  });

  it("입력 기다림 런은 '입력 기다림', 연결 끊김 런은 '연결 끊김'으로 손댈 일에 보인다", () => {
    const { db } = seedDatabase();
    const attention = sectionRows(
      render(loadHomePage(db, "ws-commerce", now)),
      homeJson.section.attention,
    );
    expect(attention.get("ACME-11")).toContain(domain.runState["waiting-for-input"]);
    expect(attention.get("ACME-12")).toContain(domain.runState.disconnected);
    expect(domain.runState["waiting-for-input"]).toBe("입력 기다림");
    expect(domain.runState.disconnected).toBe("연결 끊김");
  });

  it("손댈 일의 Ended 런은 에이전트 결과와 PR 상태를 두 칸에 따로 보인다", () => {
    const { db } = seedDatabase();
    const attention = sectionRows(
      render(loadHomePage(db, "ws-commerce", now)),
      homeJson.section.attention,
    );
    // 티켓 | 이유 | 상태 | 에이전트 결과 | PR 상태 | …
    expect(attention.get("ACME-2")?.slice(1, 5)).toEqual([
      homeJson.row["human-check"],
      domain.summary["human-check"],
      domain.agentResult["exited-with-error"],
      domain.prState.open,
    ]);
  });

  it("Queued 런에 순서에서 빠진 이유를 보인다(Q68)", () => {
    const { db } = seedDatabase();
    const queued = sectionRows(
      render(loadHomePage(db, "ws-commerce", now)),
      homeJson.section.queued,
    );
    expect(queued.get(offlineQueuedKey)).toContain(domain.queuedReason["runner-offline"]);
  });

  it("질문으로 기다리는 런은 질문 내용, 선택지, 답하기 칸을 보인다", () => {
    const { db, ids } = seedDatabase();
    const page = withInput(loadHomePage(db, "ws-commerce", now), {
      kind: "question",
      questionId: "q-1",
      body: "어느 쪽으로 할까요?",
      choices: ["A", "B"],
      answered: false,
    });
    const html = render(page, `run:${ids.get("ACME-11") ?? ""}`);
    const panel = panelText(html);
    expect(sectionRows(html, homeJson.section.attention).get("ACME-11")).toContain(
      "질문: 어느 쪽으로 할까요?",
    );
    expect(panel).toContain(homeJson.question.title);
    expect(panel).toContain("어느 쪽으로 할까요?");
    expect(panel).toContain(homeJson.question.answerLabel);
    expect(panel).toContain(homeJson.question.send);
    expect(html).toMatch(/<button[^>]*>A<\/button>/);
    expect(html).toMatch(/<button[^>]*>B<\/button>/);
  });

  it("권한 대기 런은 러너에서 허용하라는 안내와 거절만 보인다", () => {
    const { db, ids } = seedDatabase();
    const page = withInput(loadHomePage(db, "ws-commerce", now), {
      kind: "permission",
      promptId: "p-1",
      denied: false,
    });
    const panel = panelText(render(page, `run:${ids.get("ACME-11") ?? ""}`));
    expect(panel).toContain(homeJson.permission.allowOnRunner);
    expect(panel).toContain(homeJson.permission.deny);
    expect(panel).not.toContain("허용하기");
    expect(panel).not.toContain(homeJson.question.send);
  });

  it("취소를 요청한 런에는 '취소 중'을 함께 보인다(Q82.21)", () => {
    const { db } = seedDatabase();
    const page = loadHomePage(db, "ws-commerce", now);
    const cancelling: HomePage = {
      ...page,
      running: page.running.map((run) => ({ ...run, cancelling: true })),
    };
    const running = sectionRows(render(cancelling), homeJson.section.running);
    expect(running.get("ACME-10")).toContain(homeJson.cancelling);
  });

  it("GitHub 인증이 깨진 러너는 손댈 일에 해결 안내와 함께 보인다", () => {
    const { db } = seedDatabase();
    const page = loadHomePage(db, "ws-commerce", now);
    const html = render(
      {
        ...page,
        attention: [
          { kind: "runner-auth", runner: { id: "runner-a", name: "runner-a" } },
          ...page.attention,
        ],
      },
      "runner:runner-a",
    );
    expect(sectionRows(html, homeJson.section.attention).get("runner-a")).toContain(
      homeJson.row.runnerAuth,
    );
    const panel = panelText(html);
    expect(panel).toContain(homeJson.runnerAuth.fixToken);
    expect(panel).toContain(homeJson.runnerAuth.fixSsh);
  });

  it("전체에서는 손댈 일만 보이고 Workspace 칸을 둔다", () => {
    const { db } = seedDatabase();
    const html = render(loadHomePage(db, "all", now));
    expect(html).toContain(homeJson.subtitleAll);
    expect(html).toContain(homeJson.section.attention);
    expect(html).not.toContain(`>${homeJson.section.running}</h2>`);
    expect(html).not.toContain(`>${homeJson.section.queued}</h2>`);
    expect(html).toContain(homeJson.columns.workspace);
    expect(sectionRows(html, homeJson.section.attention).get("ACME-2")).toContain("Acme Commerce");
  });

  it("문구는 메시지 파일에서 온다", () => {
    const { db } = seedDatabase();
    const html = render(loadHomePage(db, "ws-commerce", now));
    expect(html).not.toMatch(/\b(home|domain)\.[a-zA-Z]/);
  });
});
