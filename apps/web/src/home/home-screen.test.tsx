import { toRunId, toTicketKey } from "@ganger/core";
import { Text } from "@ganger/ui";
import { describe, expect, it } from "vitest";
import domain from "../../messages/ko/domain.json" with { type: "json" };
import homeJson from "../../messages/ko/home.json" with { type: "json" };
import { buttonsOf } from "../testing/buttons";
import { pillsOf } from "../testing/pills";
import { renderWithMessages } from "../testing/render";
import { addTitledRun, now, seedDatabase } from "../testing/seed";
import { HomeScreen, QuestionForm, STOPPED_VISIBLE, runHref } from "./home-screen";
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

function balanced(html: string, start: number, tag: string): string {
  const pattern = new RegExp(`<${tag}\\b|</${tag}>`, "g");
  pattern.lastIndex = start;
  let depth = 0;
  for (const match of html.matchAll(pattern)) {
    if (match.index < start) continue;
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(start, match.index + match[0].length);
  }
  return html.slice(start);
}

function section(html: string, name: string): string {
  const start = html.indexOf(`<section aria-label="${name}"`);
  return start < 0 ? "" : balanced(html, start, "section");
}

function group(html: string, kind: string): string {
  const start = html.indexOf(`<div data-group="${kind}"`);
  return start < 0 ? "" : balanced(html, start, "div");
}

function rows(html: string): string[] {
  return [...html.matchAll(/<li\b[^>]*>.*?<\/li>/gs)].map((m) => m[0]);
}

function row(html: string, key: string): string {
  return rows(html).find((li) => li.includes(`>${key}</span>`)) ?? "";
}

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function dots(html: string): string[] {
  return [...html.matchAll(/<span data-status="([^"]+)" data-tone="[^"]+"/g)].map(
    (m) => m[1] ?? "",
  );
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
    id: toRunId("run-permission"),
    ticketKey: toTicketKey("ACME-22"),
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

describe("Dashboard 제목(ADR 0010 8번, 0068 갱신)", () => {
  it("메타 줄 Dashboard, 결론 제목, 묶음별 요약 문장을 보인다", () => {
    const page = seededPage();
    const html = render(page);
    expect(html).toMatch(/<p[^>]*>Dashboard<\/p>/);
    expect(html).toMatch(/<h1[^>]*>처리할 일이 8개 있어요<\/h1>/);
    expect(text(html)).toContain("답할 질문 1개, 확인할 PR 1개, 멈춘 런 6개예요.");
  });

  it("요약 문장에서 0인 묶음은 뺀다", () => {
    const page = seededPage();
    const html = render({
      ...page,
      attention: page.attention.filter((item) => item.run.ticketKey === "ACME-2"),
    });
    expect(html).toMatch(/<h1[^>]*>처리할 일이 1개 있어요<\/h1>/);
    expect(text(html)).toContain("확인할 PR 1개예요.");
    expect(text(html)).not.toContain("답할 질문");
    expect(text(html)).not.toContain("멈춘 런");
  });

  it("To do 가 0이면 처리할 일이 없다고 하고 In progress 수를 요약한다", () => {
    const page = seededPage();
    const empty = { ...page, attention: [] };
    const html = render(empty);
    expect(html).toMatch(/<h1[^>]*>처리할 일이 없어요<\/h1>/);
    expect(text(html)).toContain(
      `진행 중인 런이 ${page.running.length + page.queued.length}개 있어요.`,
    );
    expect(text(render({ ...empty, running: [], queued: [] }))).toContain(homeJson.summary.idle);
  });

  it("모든 Workspace 보기는 메타 줄에 모든 Workspace 를 붙인다", () => {
    expect(render(seededPage("all"))).toMatch(/<p[^>]*>Dashboard · 모든 Workspace<\/p>/);
  });
});

describe("Dashboard 배치(0068 갱신)", () => {
  it("왼쪽 To do·In progress, 오른쪽 Runners·Done today 순서이고 To do·In progress 제목은 h2, 오른쪽 열 제목은 h3 이다", () => {
    const html = render(seededPage());
    const names = ["To do", "In progress", "Runners", "Done today"];
    const order = names.map((name) => html.indexOf(`<section aria-label="${name}"`));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual(order.toSorted((a, b) => a - b));
    expect(section(html, "To do")).toMatch(/<h2[^>]*>To do<\/h2>/);
    expect(section(html, "In progress")).toMatch(/<h2[^>]*>In progress<\/h2>/);
    expect(section(html, "Runners")).toMatch(/<h3[^>]*>Runners<\/h3>/);
    expect(section(html, "Done today")).toMatch(/<h3[^>]*>Done today<\/h3>/);
  });

  it("To do 행은 알약 없이 묶음 머리의 색 점이 상태를 대신한다(ADR 0010 4번 예외)", () => {
    const todo = section(render(withPermission(withInput(seededPage(), question))), "To do");
    expect(pillsOf(todo)).toEqual([]);
    expect([...todo.matchAll(/<div data-status="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "question",
      "human-check",
      "failed",
    ]);
  });
});

describe("To do 묶음", () => {
  it("답이 필요해요·확인해 주세요·멈췄어요 순서로 묶고 머리에 수와 설명을 한 번만 둔다", () => {
    const html = render(withPermission(withInput(seededPage(), question)));
    const todo = section(html, "To do");
    expect(text(todo)).toMatch(/^To do 9/);
    const expected = [
      ["answer", homeJson.group.answer, 2],
      ["check", homeJson.group.check, 1],
      ["stopped", homeJson.group.stopped, 6],
    ] as const;
    for (const [kind, messages, count] of expected) {
      const block = group(todo, kind);
      expect(block).toMatch(
        new RegExp(`<h3[^>]*>${messages.title}<span[^>]*> <!-- -->${count}</span></h3>`),
      );
      expect(block.split(messages.description)).toHaveLength(2);
      expect(rows(block)).toHaveLength(
        Math.min(count, kind === "stopped" ? STOPPED_VISIBLE : count),
      );
    }
  });

  it("묶음 행은 Run 상세로 가는 키 링크이고 행동 버튼은 링크 밖에 둔다", () => {
    const page = seededPage();
    const todo = section(render(page), "To do");
    const human = row(todo, "ACME-2");
    expect(human).toContain(`href="${runHref(runOf(page, "ACME-2"))}"`);
    expect(text(human)).toContain("PR #2");
    expect(human).toMatch(
      /<\/a><\/span><span[^>]*><span data-slot="action"[^>]*><a href="https:\/\/example.com\/acme\/web\/pull\/2"[^>]*>PR 보기<\/a>/,
    );
    expect(todo).not.toContain('href="/runners');
  });

  it("시간은 링크 안 같은 폭 시간 칸에, 버튼은 같은 폭 버튼 칸에 두고 버튼 없는 행도 빈 칸을 남긴다(티켓 0091)", () => {
    const page = withPermission(withInput(seededPage(), question));
    const todo = section(render(page), "To do");
    const slots = (html: string, slot: string) =>
      html.match(new RegExp(`data-slot="${slot}"`, "g"))?.length ?? 0;
    const shown = rows(todo).length;
    expect(shown).toBeGreaterThan(3);
    expect(slots(todo, "time")).toBe(shown);
    expect(slots(todo, "action")).toBe(shown);
    const asking = row(todo, "ACME-11");
    expect(asking).toMatch(/<span data-slot="time"[^>]*>\d+분째<\/span><\/span><\/a>/);
    expect(asking).toMatch(/<span data-slot="action"[^>]*><button/);
    const failed = row(group(todo, "stopped"), "ACME-7");
    expect(failed).toMatch(/<span data-slot="action"[^>]*><\/span>/);
  });

  it("멈췄어요는 Disconnected 를 러너와 함께, Failed 를 끝난 시간과 함께 보이고 처음 3개만 그린 뒤 더 보기를 둔다", () => {
    const page = seededPage();
    const stopped = group(section(render(page), "To do"), "stopped");
    expect(text(row(stopped, "ACME-12"))).toContain("runner-a에 닿지 않아요");
    expect(text(row(stopped, "ACME-7"))).toContain("Failed · 1시간 전");
    expect(rows(stopped)).toHaveLength(STOPPED_VISIBLE);
    expect(buttonsOf(stopped)).toEqual([{ variant: "ghost", label: "3개 더 보기" }]);
  });

  it("멈췄어요가 3개 이하면 더 보기를 두지 않는다", () => {
    const page = seededPage();
    const keep = new Set(["ACME-12", "ACME-7", "ACME-6"]);
    const html = render({
      ...page,
      attention: page.attention.filter((item) => keep.has(item.run.ticketKey)),
    });
    expect(buttonsOf(group(html, "stopped"))).toEqual([]);
    expect(rows(group(html, "stopped"))).toHaveLength(3);
  });

  it("Disconnected 런의 닿지 않은 시간은 경과로 쓴다", () => {
    const page = seededPage();
    const html = render({
      ...page,
      attention: page.attention.map((item) =>
        item.run.state === "disconnected"
          ? { ...item, run: { ...item.run, unreachableMs: 7 * 60_000 } }
          : item,
      ),
    });
    expect(text(row(html, "ACME-12"))).toContain("runner-a에 7분째 닿지 않아요");
  });

  it("Question 행은 질문 문장과 기다린 경과, 답하기를 보이고 선택지는 레이어 전까지 그리지 않는다", () => {
    const html = render(withInput(seededPage(), question));
    const q = row(group(html, "answer"), "ACME-11");
    expect(text(q)).toContain(question.body);
    expect(text(q)).toContain("25분째");
    expect(buttonsOf(q)).toEqual([{ variant: "secondary", label: homeJson.row.answer }]);
    expect(q).not.toContain("지수 백오프");
    expect(q).not.toContain('type="radio"');
  });

  it("Permission 행은 명령과 허용 안내를 보이고 거절하기는 빨간 글자 보조 버튼이다(ADR 0010 6번)", () => {
    const html = render(withPermission(seededPage()));
    const p = row(group(html, "answer"), "ACME-22");
    expect(text(p)).toContain("git push --force · 허용은 러너에서 할 수 있어요");
    expect(buttonsOf(p)).toEqual([{ variant: "danger", label: homeJson.row.deny }]);
  });

  it("화면의 버튼은 보조·위험·덜 중요한 버튼뿐이고, 노란 주 버튼은 레이어 안의 보내기 하나다(ADR 0010 6번)", () => {
    const html = render(withPermission(withInput(seededPage(), question)));
    const variants = [...html.matchAll(/data-variant="([^"]+)"/g)].map((m) => m[1]);
    expect(variants).not.toContain("primary");
    expect(new Set(variants)).toEqual(new Set(["secondary", "danger", "ghost"]));
    const layer = buttonsOf(renderForm(question));
    expect(layer.filter((b) => b.variant === "primary")).toEqual([
      { variant: "primary", label: homeJson.question.send },
    ]);
  });

  it("답을 보낸 질문과 거절을 보낸 권한 대기는 결과 문장을 status 로 보인다", () => {
    const answered = render(withInput(seededPage(), { ...question, answered: true }));
    const q = row(answered, "ACME-11");
    expect(buttonsOf(q)).toEqual([]);
    expect(q).toMatch(/<span role="status" tabindex="-1"[^>]*>답을 보냈어요/);
    const denied = render(
      withInput(seededPage(), { kind: "permission", promptId: "p-1", detail: "rm", denied: true }),
    );
    expect(row(denied, "ACME-11")).toMatch(
      /<span role="status" tabindex="-1"[^>]*>거절을 보냈어요/,
    );
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
    expect(text(row(html, "ACME-12"))).toContain(homeJson.row.cancelling);
  });

  it("To do 가 비면 안내 한 줄을 둔다", () => {
    const todo = section(render({ ...seededPage(), attention: [] }), "To do");
    expect(text(todo)).toContain(homeJson.empty.todo);
  });

  it("To do 가 비면 쉬는 반장을 장식으로 두고, 할 일이 있으면 두지 않는다(0077)", () => {
    const empty = section(render({ ...seededPage(), attention: [] }), "To do");
    expect(empty).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-mascot="resting"/);
    expect(render(seededPage())).not.toContain("data-mascot");
  });
});

describe("질문 레이어", () => {
  it("질문, 선택지 라디오, 마지막 직접 쓰기를 보이고 고르기 전에는 보내기가 꺼져 있다", () => {
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
});

describe("In progress", () => {
  it("Running·Queued 런을 상태 점·키·러너나 까닭·경과로 보이고 머리에 수와 Runs 링크를 둔다", () => {
    const page = seededPage();
    const html = section(render(page), "In progress");
    const total = page.running.length + page.queued.length;
    expect(html).toMatch(new RegExp(`<h2[^>]*>In progress</h2><span[^>]*>${total}</span>`));
    expect(html).toMatch(/<a href="\/runs\?ws=ws-commerce"[^>]*>Runs에서 보기<\/a>/);
    expect(rows(html)).toHaveLength(total);
    expect(pillsOf(html)).toEqual([]);
    const running = row(html, "ACME-10");
    expect(dots(running)).toEqual(["running"]);
    expect(text(running)).toContain("runner-a");
    expect(text(running)).toMatch(/째$/);
    expect(dots(row(html, "ACME-14"))).toEqual(["queued"]);
    expect(text(row(html, "ACME-14"))).toContain(homeJson.row.queuedAnyOffline);
  });

  it("할당 때 저장한 티켓 제목을 회색 키 옆에 보인다(ADR 0010 9번, 0064)", () => {
    const { db } = seedDatabase();
    const id = addTitledRun(db, "ACME-30", "결제 실패 재시도");
    const html = section(render(loadHomePage(db, "ws-commerce", now, "UTC")), "In progress");
    const titled = rows(html).find((li) => li.includes(`data-run="${id}"`)) ?? "";
    expect(text(titled)).toContain("ACME-30 결제 실패 재시도");
    expect(titled).toContain(
      renderWithMessages(
        <Text variant="meta" numeric>
          ACME-30
        </Text>,
      ),
    );
    expect(titled).toContain(
      renderWithMessages(
        <Text variant="title" truncate>
          결제 실패 재시도
        </Text>,
      ),
    );
  });

  it("제목을 모르는 런(0064 전에 할당한 런)은 키만 행 제목으로 보인다", () => {
    const html = section(render(seededPage()), "In progress");
    expect(row(html, "ACME-10")).toContain(
      renderWithMessages(
        <Text variant="title" numeric>
          ACME-10
        </Text>,
      ),
    );
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
});

describe("Runners", () => {
  it("러너마다 상태 점·이름·칸·숫자를 한 줄로 보이고 문제가 있으면 빨간 상자 하나를 둔다", () => {
    const html = section(render(seededPage()), "Runners");
    const offline = row(html, "runner-b");
    expect(dots(offline)).toEqual(["offline"]);
    expect(offline).toContain('href="/runners?sel=runner-b"');
    expect(offline).toMatch(/role="img" aria-label="1자리 중 0자리 사용" data-tone="problem"/);
    expect(text(offline)).toBe("Offline runner-b 0/1");
    const online = row(html, "runner-a");
    expect(dots(online)).toEqual(["online"]);
    expect(online).toMatch(/role="img" aria-label="10자리 중 4자리 사용" data-tone="progress"/);
    expect(html.indexOf("runner-b")).toBeLessThan(html.indexOf("runner-a"));

    expect([...html.matchAll(/<section aria-labelledby/g)]).toHaveLength(1);
    expect(html).toMatch(/<h3[^>]*>러너 1대에 문제가 있어요<\/h3>/);
    expect(text(html)).toContain("Offline이에요: runner-b(2시간째)");
    expect(html).toMatch(
      /<a href="\/runners" data-variant="secondary"[^>]*>Runners에서 고치기<\/a>/,
    );
  });

  it("칸 하나가 자리 하나이고, 쓰는 자리는 Online이면 초록·문제 러너면 빨강, 빈자리는 테두리만이다", () => {
    const page = seededPage();
    const html = section(
      render({
        ...page,
        runners: {
          list: [
            {
              id: "r-half",
              name: "mac-half",
              cause: null,
              offlineMs: null,
              used: 2,
              capacity: 3,
              usage: null,
              limits: [],
            },
            {
              id: "r-full",
              name: "mac-full",
              cause: null,
              offlineMs: null,
              used: 3,
              capacity: 3,
              usage: null,
              limits: [],
            },
            {
              id: "r-auth",
              name: "mac-auth",
              cause: "auth",
              offlineMs: null,
              used: 1,
              capacity: 2,
              usage: null,
              limits: [],
            },
          ],
        },
      }),
      "Runners",
    );
    const cells = (name: string) =>
      [...row(html, name).matchAll(/data-cell="(used|free)"/g)].map((m) => m[1]);
    expect(cells("mac-half")).toEqual(["used", "used", "free"]);
    expect(cells("mac-full")).toEqual(["used", "used", "used"]);
    expect(cells("mac-auth")).toEqual(["used", "free"]);
    expect(row(html, "mac-half")).toContain('data-tone="progress"');
    expect(row(html, "mac-auth")).toContain('data-tone="problem"');
    expect(text(row(html, "mac-half"))).toBe("Online mac-half 2/3");
  });

  it("구역 머리에 Online이고 문제 없는 러너의 빈자리 합을 새 런 받을 자리로 보인다", () => {
    const page = seededPage();
    const html = section(
      render({
        ...page,
        runners: {
          list: [
            {
              id: "r-half",
              name: "mac-half",
              cause: null,
              offlineMs: null,
              used: 2,
              capacity: 3,
              usage: null,
              limits: [],
            },
            {
              id: "r-free",
              name: "mac-free",
              cause: null,
              offlineMs: null,
              used: 0,
              capacity: 2,
              usage: null,
              limits: [],
            },
            {
              id: "r-over",
              name: "mac-over",
              cause: null,
              offlineMs: null,
              used: 3,
              capacity: 2,
              usage: null,
              limits: [],
            },
            {
              id: "r-off",
              name: "mac-off",
              cause: "offline",
              offlineMs: 60_000,
              used: 0,
              capacity: 4,
              usage: null,
              limits: [],
            },
            {
              id: "r-auth",
              name: "mac-auth",
              cause: "auth",
              offlineMs: null,
              used: 0,
              capacity: 4,
              usage: null,
              limits: [],
            },
          ],
        },
      }),
      "Runners",
    );
    expect(text(html)).toContain("Runners 5 새 런 받을 자리 3");
    expect(text(section(render(seededPage()), "Runners"))).toContain("새 런 받을 자리 6");
  });

  it("러너가 없으면 새 런 받을 자리 줄을 두지 않는다", () => {
    const page = seededPage();
    const html = section(render({ ...page, runners: { list: [] } }), "Runners");
    expect(text(html)).not.toContain("새 런 받을 자리");
    expect(text(html)).toContain("아직 러너가 없어요.");
  });

  it("GitHub 인증이 깨진 러너는 Runner Issue 점과 인증 까닭으로 보인다", () => {
    const page = seededPage();
    const html = section(
      render({
        ...page,
        runners: {
          list: page.runners.list.map((runner) =>
            runner.id === "runner-a" ? { ...runner, cause: "auth" as const } : runner,
          ),
        },
      }),
      "Runners",
    );
    expect(dots(row(html, "runner-a"))).toEqual(["runner-issue"]);
    expect(html).toMatch(/<h3[^>]*>러너 2대에 문제가 있어요<\/h3>/);
    expect(text(html)).toContain("GitHub 인증을 다시 해야 해요: runner-a");
  });

  it("문제가 없으면 빨간 상자가 없다", () => {
    const page = seededPage();
    const html = section(
      render({ ...page, runners: { list: page.runners.list.filter((r) => r.cause === null) } }),
      "Runners",
    );
    expect(html).not.toContain("<section aria-labelledby");
  });
});

describe("Done today", () => {
  it("상태 점·키·요약 결과·상대 시간과 Runs 링크를 보인다", () => {
    const page = seededPage();
    const html = section(render(page), "Done today");
    expect(html).toMatch(
      new RegExp(`<h3[^>]*>Done today</h3><span[^>]*>${page.doneToday.total}</span>`),
    );
    expect(html).toMatch(/<a href="\/runs\?ws=ws-commerce"[^>]*>Runs에서 모두 보기<\/a>/);
    const done = row(html, "ACME-7");
    expect(dots(done)).toEqual(["failed"]);
    expect(done).toContain(`href="${runHref(page.doneToday.recent[0] ?? runOf(page, "ACME-7"))}"`);
    expect(done).toMatch(/<time dateTime="[^"]+"[^>]*>1시간 전<\/time>/);
    expect(rows(html)).toHaveLength(page.doneToday.recent.length);
  });
});

describe("모든 Workspace 보기(0066)", () => {
  it("네 구역을 모두 보이고 To do·In progress·Done today 행에 Workspace 이름을 붙인다", () => {
    const html = render(seededPage("all"));
    for (const name of ["To do", "In progress", "Runners", "Done today"])
      expect(section(html, name)).not.toBe("");
    expect(text(row(section(html, "To do"), "ACME-2"))).toContain("Acme Commerce");
    expect(text(row(section(html, "In progress"), "ACME-10"))).toContain("Acme Commerce");
    expect(text(row(section(html, "Done today"), "ACME-7"))).toContain("Acme Commerce");
    expect(section(html, "Done today")).toMatch(/<a href="\/runs"[^>]*>Runs에서 모두 보기<\/a>/);
  });
});

describe("문구", () => {
  it("상태 이름은 GLOSSARY 영어 용어다(ADR 0010 1번)", () => {
    const html = render(seededPage());
    const terms = new Map<string, string>([
      ...Object.entries(domain.runState),
      ...Object.entries(domain.summary),
      ...Object.entries(domain.runnerState),
      ...Object.entries(domain.attention),
    ]);
    const named = [
      ...html.matchAll(
        /<span data-status="([^"]+)" data-tone="[^"]+"[^>]*><span aria-hidden="true"[^>]*><\/span><span[^>]*>([^<]+)<\/span>/g,
      ),
    ];
    expect(named.length).toBeGreaterThan(5);
    for (const [, status, label] of named) expect(label).toBe(terms.get(status ?? ""));
  });

  it("문구는 메시지 파일에서 온다", () => {
    const html = render(withPermission(withInput(seededPage(), question))) + renderForm(question);
    expect(html).not.toMatch(/\b(home|domain)\.[a-zA-Z]/);
  });
});

describe("Runners 공급자 사용량(0086)", () => {
  const base = { cause: null, offlineMs: null, used: 1, capacity: 2, limits: [] };

  it("러너 행 아래에 가장 높은 사용량을 숫자로, 90% 이상이면 빨강 글자로 보인다", () => {
    const html = section(
      render({
        ...seededPage(),
        runners: {
          list: [
            {
              ...base,
              id: "r-a",
              name: "mac-a",
              usage: { provider: "claude", window: "weekly", usedPercent: 72.4 },
            },
            {
              ...base,
              id: "r-b",
              name: "mac-b",
              usage: { provider: "codex", window: "session", usedPercent: 93 },
            },
            { ...base, id: "r-c", name: "mac-c", usage: null },
          ],
        },
      }),
      "Runners",
    );
    expect(text(row(html, "mac-a"))).toBe("Online mac-a Claude 주간 72% 1/2");
    expect(text(row(html, "mac-b"))).toContain("Codex 5시간 93%");
    expect(row(html, "mac-a")).toContain(
      renderWithMessages(
        <Text variant="meta" numeric>
          Claude 주간 72%
        </Text>,
      ),
    );
    expect(row(html, "mac-b")).toContain(
      renderWithMessages(
        <Text variant="meta" numeric tone="problem">
          Codex 5시간 93%
        </Text>,
      ),
    );
    expect(text(row(html, "mac-c"))).toBe("Online mac-c 1/2");
  });

  it("100%에 닿은 러너는 문제 상자에 한 줄, 머리 문장에 언제 다시 받는지 보인다", () => {
    const page: HomePage = {
      ...seededPage(),
      runners: {
        list: [
          {
            ...base,
            id: "r-c",
            name: "runner-c",
            usage: { provider: "claude", window: "session", usedPercent: 100 },
            limits: [{ provider: "claude", window: "session", resetsInMs: 72 * 60_000 }],
          },
          { ...base, id: "r-a", name: "runner-a", usage: null },
        ],
      },
    };
    const html = render(page);
    const runners = section(html, "Runners");
    expect(text(runners)).toContain("러너 1대에 문제가 있어요");
    expect(text(runners)).toContain(
      "Claude 5시간 한도에 닿았어요: runner-c · 1시간 12분 뒤 한도가 풀리면 다시 런을 받아요",
    );
    expect(text(html)).toContain(
      "한도에 닿은 러너 1대는 1시간 12분 뒤 한도가 풀리면 다시 런을 받아요.",
    );
  });

  it("한도에 닿은 러너가 없으면 문제 상자와 머리 문장에 한도 이야기가 없다", () => {
    const html = render({
      ...seededPage(),
      runners: { list: [{ ...base, id: "r-a", name: "runner-a", usage: null }] },
    });
    expect(text(html)).not.toContain("한도");
  });
});
