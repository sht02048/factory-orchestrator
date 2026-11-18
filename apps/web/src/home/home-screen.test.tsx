import { describe, expect, it } from "vitest";
import domain from "../../messages/ko/domain.json" with { type: "json" };
import homeJson from "../../messages/ko/home.json" with { type: "json" };
import { buttonsOf } from "../testing/buttons";
import { pillsOf } from "../testing/pills";
import { renderWithMessages } from "../testing/render";
import { now, seedDatabase } from "../testing/seed";
import { HomeScreen, QuestionForm } from "./home-screen";
import { loadHomePage } from "./load";
import { homeMessages } from "./messages";
import type { HomePage, HomeRun, InputWait } from "./model";

const reject = () => Promise.reject(new Error("unused"));

function render(page: HomePage) {
  return renderWithMessages(
    <HomeScreen page={page} onAnswer={reject} onDeny={reject} />,
    homeMessages,
  );
}

function renderForm(question: Extract<InputWait, { kind: "question" }>) {
  return renderWithMessages(<QuestionForm question={question} onSend={reject} />, homeMessages);
}

function seededPage(ws = "ws-commerce"): HomePage {
  const { db } = seedDatabase();
  return loadHomePage(db, ws, now, "UTC");
}

function section(html: string, name: string): string {
  const labelled = new RegExp(`<section aria-labelledby="([^"]+)"`, "g");
  for (const match of html.matchAll(labelled)) {
    const start = match.index;
    const end = html.indexOf("</section>", start);
    const body = html.slice(start, end);
    if (body.includes(`id="${match[1]}"`) && body.includes(`>${name}</h2>`)) return body;
  }
  const start = html.indexOf(`<section aria-label="${name}"`);
  if (start < 0) return "";
  return html.slice(start, html.indexOf("</section>", start));
}

function row(html: string, key: string): string {
  const pattern = new RegExp(`<li[^>]*>(?:(?!</li>).)*?>${key}</a>.*?</li>`, "s");
  return pattern.exec(html)?.[0] ?? "";
}

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
}

function runOf(page: HomePage, key: string): HomeRun {
  const found = page.attention.find((item) => item.run.ticketKey === key);
  if (found === undefined) throw new Error(`no ${key}`);
  return found.run;
}

function withInput(page: HomePage, input: InputWait): HomePage {
  return {
    ...page,
    attention: page.attention.map((item) =>
      item.run.ticketKey === "ACME-11" && item.run.state === "waiting-for-input"
        ? { ...item, run: { ...item.run, input, waitingMs: 25 * 60_000 } }
        : item,
    ),
  };
}

function withPermission(page: HomePage): HomePage {
  const acme11 = runOf(page, "ACME-11");
  const permissionRun: HomeRun = {
    ...acme11,
    id: "run-permission",
    ticketKey: "ACME-22",
    state: "waiting-for-input",
    input: { kind: "permission", promptId: "p-1", detail: "git push --force", denied: false },
    waitingMs: null,
  };
  return { ...page, attention: [...page.attention, { kind: "run", run: permissionRun }] };
}

const question: Extract<InputWait, { kind: "question" }> = {
  kind: "question",
  questionId: "q-1",
  body: "재시도 간격을 바꿀까요?",
  choices: ["지수 백오프", "30초 고정"],
  answered: false,
};

describe("Dashboard", () => {
  it("제목 Dashboard 와 처리할 일·확인할 러너 수 요약 한 줄을 보인다(ADR 0010 8번)", () => {
    const page = seededPage();
    const html = render(page);
    expect(html).toContain(`>${homeJson.title}</h1>`);
    expect(text(html)).toContain(
      `처리할 일이 ${page.attention.length}개, 확인할 러너가 ${page.runners.issues.length}대 있어요.`,
    );
  });

  it("왼쪽에 To do·In progress, 오른쪽에 Runners·Done today 를 두고 개수 타일과 흐름은 없다", () => {
    const html = render(seededPage());
    const order = ["To do", "In progress", "Runners", "Done today"].map((name) =>
      html.indexOf(section(html, name)),
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual(order.toSorted((a, b) => a - b));
    expect(html).not.toContain("<aside");
    expect(html).not.toContain("<dl");
  });

  it("러너 문제는 To do 에 없고 Runners 카드에 이름 링크와 까닭으로 보인다(티켓 0060)", () => {
    const page = seededPage();
    const html = render(page);
    const todo = section(html, "To do");
    expect(pillsOf(todo).map((p) => p.status)).not.toContain("runner-issue");
    expect(todo).not.toContain("runner-b");

    const runners = section(html, homeJson.section.runners);
    expect(runners).toMatch(/<h2 id="[^"]+"[^>]*>Runners<\/h2>/);
    expect(text(runners)).toContain("1대를 확인해주세요");
    expect(runners).toContain('href="/runners?sel=runner-b"');
    expect(text(row(runners, "runner-b"))).toContain(homeJson.runners.offline);
    const online =
      /<li[^>]*>(?:(?!<\/li>).)*data-status="online".*?<\/li>/s.exec(runners)?.[0] ?? "";
    expect(pillsOf(online)).toEqual([{ status: "online", label: "Online" }]);
    expect(text(online).trim()).toBe("Online 1대");
    expect(runners).toContain('href="/runners"');
  });

  it("GitHub 인증이 깨진 러너는 인증 까닭으로 보인다", () => {
    const page = seededPage();
    const html = render({
      ...page,
      runners: {
        issues: [{ id: "runner-a", name: "runner-a", cause: "auth" }, ...page.runners.issues],
        online: 0,
      },
    });
    const runners = section(html, homeJson.section.runners);
    expect(text(row(runners, "runner-a"))).toContain("GitHub 인증을 다시 해주세요");
    expect(text(runners)).toContain("2대를 확인해주세요");
    expect(runners).not.toContain('data-status="online"');
  });

  it("To do 행은 알약과 Run 상세로 가는 키 링크, 까닭을 보이고 행 전체를 링크로 하지 않는다", () => {
    const page = seededPage();
    const html = render(page);
    const todo = section(html, "To do");
    const human = row(todo, "ACME-2");
    expect(pillsOf(human)).toEqual([{ status: "human-check", label: "Human Check" }]);
    expect(human).toMatch(/<a href="\/runs\/[^"?]+\?ws=ws-commerce"[^>]*>ACME-2<\/a>/);
    expect(text(human)).toContain("PR #2를 확인해주세요");
    expect(human).toMatch(/<a href="https:\/\/example.com\/acme\/web\/pull\/2"[^>]*>PR 보기<\/a>/);
    expect(text(row(todo, "ACME-12"))).toContain("runner-a에");
    expect(text(row(todo, "ACME-3"))).toContain(homeJson.row.failed);
    expect(todo).not.toMatch(/<li[^>]*>\s*<a /);
    expect([...todo.matchAll(/<li\b/g)]).toHaveLength(page.attention.length);
  });

  it("상태 알약 글은 GLOSSARY 영어 용어이고 종류와 맞는다(ADR 0010 1·4번)", () => {
    const html = render(withPermission(withInput(seededPage(), question)));
    const terms = new Map<string, string>([
      ...Object.entries(domain.runState),
      ...Object.entries(domain.summary),
      ...Object.entries(domain.attention),
      ...Object.entries(domain.runnerState),
    ]);
    const todo = pillsOf(section(html, "To do"));
    expect(new Set(todo.map((p) => p.status))).toEqual(
      new Set(["question", "permission", "disconnected", "human-check", "failed"]),
    );
    for (const pill of pillsOf(html)) expect(pill.label).toBe(terms.get(pill.status));
  });

  it("Question 행은 질문 문장을 까닭 자리에, 답하기를 오른쪽에 두고 선택지는 레이어 전까지 그리지 않는다", () => {
    const html = render(withInput(seededPage(), question));
    const q = row(section(html, "To do"), "ACME-11");
    expect(text(q)).toContain(question.body);
    expect(buttonsOf(q)).toEqual([{ variant: "secondary", label: homeJson.row.answer }]);
    expect(q).not.toContain("지수 백오프");
    expect(q).not.toContain('type="radio"');
  });

  it("Permission 행은 명령과 허용 안내를 보이고 거절하기는 빨간 글자 보조 버튼이다(ADR 0010 6번)", () => {
    const html = render(withPermission(seededPage()));
    const p = row(section(html, "To do"), "ACME-22");
    expect(text(p)).toContain(
      "git push --force를 실행해도 될지 묻고 있어요 · 허용은 러너에서 할 수 있어요",
    );
    expect(buttonsOf(p)).toEqual([{ variant: "danger", label: homeJson.row.deny }]);
    expect(text(p)).not.toContain("허용하기");
  });

  it("화면의 행 버튼은 모두 보조 버튼이고, 파란 주 버튼은 레이어 안의 보내기 하나뿐이다(ADR 0010 6번)", () => {
    const html = render(withPermission(withInput(seededPage(), question)));
    const variants = [...html.matchAll(/data-variant="([^"]+)"/g)].map((m) => m[1]);
    expect(variants.length).toBeGreaterThanOrEqual(3);
    expect(variants).not.toContain("primary");
    expect(variants.every((v) => v === "secondary" || v === "danger")).toBe(true);

    const layer = buttonsOf(renderForm(question));
    expect(layer.filter((b) => b.variant === "primary")).toEqual([
      { variant: "primary", label: homeJson.question.send },
    ]);
  });

  it("질문 레이어는 질문, 선택지 라디오, 마지막 직접 쓰기를 보이고 고르기 전에는 보내기가 꺼져 있다", () => {
    const html = renderForm(question);
    expect(html).toMatch(/<legend[^>]*>재시도 간격을 바꿀까요\?<\/legend>/);
    const radios = [...html.matchAll(/<input type="radio"[^>]*>\s*<span[^>]*>([^<]+)<\/span>/g)];
    expect(radios.map((m) => m[1])).toEqual([...question.choices, homeJson.question.other]);
    expect(html).not.toContain("checked");
    expect(html).toMatch(
      /<button[^>]*data-variant="primary"[^>]*disabled=""[^>]*>보내기<\/button>/,
    );
    expect(text(html)).toContain(homeJson.question.pick);
    expect(html).not.toContain("<textarea");
  });

  it("긴 선택지 문구는 자르지 않고 그대로 다 그린다", () => {
    const long = `${"재시도 간격을 지수 백오프로 바꾸고 최대 다섯 번까지 다시 시도한 뒤 ".repeat(4)}끝내요`;
    const html = renderForm({ ...question, choices: [long, "30초 고정"] });
    expect(html).toContain(`>${long}</span>`);
    expect(html).not.toContain("…");
  });

  it("답을 보낸 질문은 답하기 대신 결과 문장을 status 로 보인다", () => {
    const html = render(withInput(seededPage(), { ...question, answered: true }));
    const q = row(section(html, "To do"), "ACME-11");
    expect(buttonsOf(q)).toEqual([]);
    expect(q).toMatch(/<span role="status" tabindex="-1"[^>]*>답을 보냈어요/);
  });

  it("거절을 보낸 권한 대기는 결과 문장을 status 로 보인다", () => {
    const html = render(
      withInput(seededPage(), { kind: "permission", promptId: "p-1", detail: "rm", denied: true }),
    );
    const p = row(section(html, "To do"), "ACME-11");
    expect(p).toMatch(/<span role="status" tabindex="-1"[^>]*>거절을 보냈어요/);
  });

  it("In progress 는 Running·Queued 런을 모두 보이고 머리에 수와 Runs 링크를 둔다", () => {
    const page = seededPage();
    const html = section(render(page), "In progress");
    expect(text(html)).toContain(`Running ${page.running.length} · Queued ${page.queued.length}`);
    expect(html).toMatch(/<a href="\/runs\?ws=ws-commerce"[^>]*>Runs에서 보기<\/a>/);
    expect([...html.matchAll(/<li\b/g)]).toHaveLength(page.running.length + page.queued.length);
    expect(pillsOf(row(html, "ACME-10"))).toEqual([{ status: "running", label: "Running" }]);
    expect(text(row(html, "ACME-10"))).toContain("runner-a");
    expect(text(row(html, "ACME-14"))).toContain(homeJson.row.queuedAnyOffline);
  });

  it("Queued 까닭은 러너 이름에 맞는 조사로 쓴다", () => {
    const page = seededPage();
    const queued = page.queued.map((run) =>
      run.state === "queued"
        ? {
            ...run,
            queuedReason: { kind: "runner-offline" as const },
            runner: { name: "build-farm", online: false },
          }
        : run,
    );
    const html = section(render({ ...page, queued }), "In progress");
    expect(text(html)).toContain("build-farm이 Offline이라 기다려요");
  });

  it("Done today 는 제목, 전체 수, 상태 알약, 키 링크, 끝난 상대 시간과 모두 보기를 보인다", () => {
    const page = seededPage();
    const html = section(render(page), homeJson.section.doneToday);
    expect(html).toMatch(/<h2 id="[^"]+"[^>]*>Done today<\/h2>/);
    expect(text(html)).toContain(`Done today ${page.doneToday.total}개`);
    expect(html).toMatch(/<a href="\/runs\?ws=ws-commerce"[^>]*>모두 보기<\/a>/);
    const done = row(html, "ACME-7");
    expect(pillsOf(done)).toEqual([{ status: "failed", label: "Failed" }]);
    expect(done).toMatch(/<time dateTime="[^"]+"[^>]*>1시간 전<\/time>/);
    expect([...html.matchAll(/<li\b/g)]).toHaveLength(page.doneToday.recent.length);
  });

  it("취소를 요청한 런에는 '취소 중'을 함께 보인다(Q82.21)", () => {
    const page = seededPage();
    const html = render({
      ...page,
      attention: page.attention.map((item) =>
        item.run.ticketKey === "ACME-12"
          ? { ...item, run: { ...item.run, cancelling: true } }
          : item,
      ),
    });
    expect(text(row(section(html, "To do"), "ACME-12"))).toContain(homeJson.row.cancelling);
  });

  it("전체에서는 To do 와 Runners 만 보이고 To do 행에 Workspace 이름을 둔다(ADR 0006)", () => {
    const html = render(seededPage("all"));
    expect(text(html)).toContain("모든 Workspace에 처리할 일이");
    expect(section(html, "In progress")).toBe("");
    expect(section(html, homeJson.section.doneToday)).toBe("");
    expect(section(html, homeJson.section.runners)).not.toBe("");
    expect(text(row(section(html, "To do"), "ACME-2"))).toContain("Acme Commerce");
  });

  it("문구는 메시지 파일에서 온다", () => {
    const html = render(withPermission(withInput(seededPage(), question))) + renderForm(question);
    expect(html).not.toMatch(/\b(home|domain)\.[a-zA-Z]/);
  });
});
