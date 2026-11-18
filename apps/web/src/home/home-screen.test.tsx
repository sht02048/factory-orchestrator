import { describe, expect, it } from "vitest";
import domain from "../../messages/ko/domain.json" with { type: "json" };
import homeJson from "../../messages/ko/home.json" with { type: "json" };
import { pillsOf } from "../testing/pills";
import { renderWithMessages } from "../testing/render";
import { now, seedDatabase } from "../testing/seed";
import { HomeScreen } from "./home-screen";
import { loadHomePage } from "./load";
import { homeMessages } from "./messages";
import type { AttentionItem, HomePage, HomeRun, InputWait } from "./model";

const reject = () => Promise.reject(new Error("unused"));

function render(page: HomePage) {
  return renderWithMessages(
    <HomeScreen page={page} onAnswer={reject} onDeny={reject} />,
    homeMessages,
  );
}

function seededPage(ws = "ws-commerce"): HomePage {
  const { db } = seedDatabase();
  return loadHomePage(db, ws, now, "UTC");
}

/** 손댈 일 카드 하나(section aria-label="{종류} {이름}")의 HTML */
function card(html: string, label: string): string {
  const start = html.indexOf(`aria-label="${label}"`);
  if (start < 0) return "";
  return html.slice(start, html.indexOf("</section>", start));
}

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

/** 버튼과 버튼 모양 링크의 변형 */
function variants(html: string): string[] {
  return [...html.matchAll(/data-variant="([^"]+)"/g)].map((m) => m[1] ?? "");
}

function runOf(page: HomePage, key: string): HomeRun {
  const found = page.attention.find(
    (item): item is Extract<AttentionItem, { kind: "run" }> =>
      item.kind === "run" && item.run.ticketKey === key,
  );
  if (found === undefined) throw new Error(`no ${key}`);
  return found.run;
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

const question: InputWait = {
  kind: "question",
  questionId: "q-1",
  body: "재시도 간격을 바꿀까요?",
  choices: ["지수 백오프", "30초 고정"],
  answered: false,
};

describe("Home", () => {
  it("제목 Home 과 손댈 일 개수 요약 한 줄을 보인다(ADR 0010 8번)", () => {
    const page = seededPage();
    const html = render(page);
    expect(html).toContain(`>${homeJson.title}</h1>`);
    expect(text(html)).toContain(`손댈 일이 ${page.attention.length}개 있어요.`);
  });

  it("손댈 일마다 카드 하나를 그리고 카드에 종류 알약과 회색 키를 둔다", () => {
    const page = seededPage();
    const html = render(page);
    const human = card(html, "Human Check ACME-2");
    expect(pillsOf(human)).toEqual([{ status: "human-check", label: "Human Check" }]);
    expect(text(human)).toContain("PR #2이 열려 있어요.");
    expect(human).toContain('href="https://example.com/acme/web/pull/2"');
    expect(text(card(html, "Disconnected ACME-12"))).toContain("runner-a에");
    expect(text(card(html, "Failed ACME-3"))).toContain(homeJson.card.failed);
    // 손댈 일 카드 수 = 손댈 일 수
    const cards = html.match(/<section aria-label="[^"]+"/g) ?? [];
    const attentionCards = cards.filter(
      (c) => !c.includes(homeJson.section.attention) && !c.includes(homeJson.activity.title),
    );
    expect(attentionCards).toHaveLength(page.attention.length);
  });

  it("상태 알약 글은 GLOSSARY 영어 용어이고 종류와 맞는다(ADR 0010 1·4번)", () => {
    const html = render(withInput(seededPage(), question));
    const terms = new Map<string, string>([
      ...Object.entries(domain.runState),
      ...Object.entries(domain.summary),
      ...Object.entries(domain.attention),
      ...Object.entries(domain.runnerState),
    ]);
    const pills = pillsOf(html);
    expect(new Set(pills.map((p) => p.status))).toEqual(
      new Set(["runner-issue", "question", "disconnected", "human-check", "failed"]),
    );
    for (const pill of pills) expect(pill.label).toBe(terms.get(pill.status));
  });

  it("카드 행동과 질문 선택지는 모두 보조 버튼이고 파란 주 버튼은 하나 이하다(ADR 0010 6번, Q18)", () => {
    // 질문 카드와 권한 카드를 함께 둔다
    const base = withInput(seededPage(), question);
    const acme11 = runOf(base, "ACME-11");
    const permissionRun: HomeRun = {
      ...acme11,
      id: "run-permission",
      ticketKey: "ACME-22",
      state: "waiting-for-input",
      input: { kind: "permission", promptId: "p-1", detail: "git push --force", denied: false },
    };
    const page: HomePage = {
      ...base,
      attention: [...base.attention, { kind: "run", run: permissionRun }],
    };
    const html = render(page);
    const all = variants(html);
    expect(all.length).toBeGreaterThan(page.attention.length);
    expect(all.filter((v) => v === "primary").length).toBeLessThanOrEqual(1);
    expect(all.every((v) => v === "secondary" || v === "danger")).toBe(true);

    const q = card(html, "Question ACME-11");
    expect(text(q)).toContain(question.body);
    expect(variants(q)).toEqual(["secondary", "secondary", "secondary"]);
    expect(q).toMatch(/<button[^>]*data-variant="secondary"[^>]*>지수 백오프<\/button>/);
    expect(q).toMatch(/<button[^>]*data-variant="secondary"[^>]*>30초 고정<\/button>/);
    expect(text(q)).toContain(homeJson.question.write);

    // 거절은 빨간 글자 보조 버튼이다. 허용은 러너 화면에서만 한다(Q82.4)
    const p = card(html, "Permission ACME-22");
    expect(text(p)).toContain("git push --force 허용은 러너 화면에서만 할 수 있어요.");
    expect(p).toMatch(/<button[^>]*data-variant="danger"[^>]*>거절<\/button>/);
    expect(text(p)).not.toContain("허용하기");
  });

  it("답을 남긴 질문은 선택지 대신 남겼다는 안내를 보인다", () => {
    const html = render(withInput(seededPage(), { ...question, answered: true }));
    const q = card(html, "Question ACME-11");
    expect(text(q)).toContain(homeJson.question.answered);
    expect(variants(q)).toEqual([]);
  });

  it("Offline 러너는 Runner Issue 카드로 까닭과 해결 방법 링크를 보인다(ADR 0010 1번)", () => {
    const html = render(seededPage());
    const runner = card(html, "Runner Issue runner-b");
    expect(pillsOf(runner)).toEqual([{ status: "runner-issue", label: "Runner Issue" }]);
    expect(text(runner)).toContain(homeJson.runnerIssue.offline);
    expect(runner).toContain('href="/runners?sel=runner-b"');
  });

  it("GitHub 인증이 깨진 러너는 인증 까닭을 설명 문장으로 보인다", () => {
    const page = seededPage();
    const html = render({
      ...page,
      attention: [
        { kind: "runner-issue", runner: { id: "runner-a", name: "runner-a", cause: "auth" } },
        ...page.attention,
      ],
    });
    expect(text(card(html, "Runner Issue runner-a"))).toContain(homeJson.runnerIssue.auth);
  });

  it("Running·Queued·오늘 Merged 수를 보인다", () => {
    const page = seededPage();
    const counts = text(render(page).split(`aria-label="${homeJson.counts.label}"`)[1] ?? "");
    expect(counts).toContain(`Running ${page.running.length}`);
    expect(counts).toContain(`Queued ${page.queued.length}`);
    expect(counts).toContain(`오늘 Merged ${page.mergedToday}`);
  });

  it("지금 일어나는 일은 회색 키, 사건 문장, 상대 시간으로 보인다(ADR 0010 7번)", () => {
    const html = render(seededPage());
    const feed = text(card(html, homeJson.activity.title));
    // 가장 최근: ACME-7 이 Failed 로 끝남(120분 - 37분 = 83분 전 → 1시간 전)
    expect(feed).toContain("ACME-7 Failed로 끝났어요 1시간 전");
    expect(feed).toContain("ACME-12 러너와 연결이 끊겼어요");
  });

  it("취소를 요청한 런에는 '취소 중'을 함께 보인다(Q82.21)", () => {
    const page = seededPage();
    const html = render({
      ...page,
      attention: page.attention.map((item) =>
        item.kind === "run" && item.run.ticketKey === "ACME-12"
          ? { ...item, run: { ...item.run, cancelling: true } }
          : item,
      ),
    });
    expect(text(card(html, "Disconnected ACME-12"))).toContain(homeJson.cancelling);
  });

  it("전체에서는 손댈 일과 Workspace 이름을 보이고 런 수는 보이지 않는다(ADR 0006)", () => {
    const html = render(seededPage("all"));
    expect(text(html)).toContain("모든 Workspace에서 손댈 일");
    expect(html).not.toContain(`aria-label="${homeJson.counts.label}"`);
    expect(text(card(html, "Human Check ACME-2"))).toContain("Acme Commerce");
  });

  it("문구는 메시지 파일에서 온다", () => {
    const html = render(seededPage());
    expect(html).not.toMatch(/\b(home|domain)\.[a-zA-Z]/);
  });
});
