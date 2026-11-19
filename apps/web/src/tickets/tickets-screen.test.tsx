import { describe, expect, it } from "vitest";
import { renderWithMessages } from "../testing/render";
import { AUTO_RUNNER, AssignForm, runnerOptionsFor } from "./assign-dialog";
import { loadTicketsPage } from "@ganger/app/tickets/load";
import { ticketsMessages } from "./messages";
import type { RunnerChoice, TicketFilter, TicketsPage } from "@ganger/app/tickets/model";
import { now, setupTickets } from "./test-fixtures";
import { TicketsScreen } from "./tickets-screen";

const noop = () => {};

function render(page: TicketsPage, options: { filter?: TicketFilter; selectedId?: string } = {}) {
  return renderWithMessages(
    <TicketsScreen
      page={page}
      workspaces={[
        { id: "ws-commerce", name: "Acme Commerce" },
        { id: "ws-labs", name: "Acme Labs" },
      ]}
      filter={options.filter ?? "all"}
      selectedId={options.selectedId}
      onFilterChange={noop}
      onSelect={noop}
      onPickWorkspace={noop}
      onOpenRun={noop}
      onAssign={() => Promise.resolve({ ok: false, reason: "active-run" })}
      onAssigned={noop}
    />,
    ticketsMessages,
  );
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

function rowTexts(html: string): Map<string, string> {
  const rows = new Map<string, string>();
  for (const chunk of html.split('role="option"').slice(1)) {
    const row = text(chunk.split("</button>")[0] ?? chunk);
    const key = /ACME-\d+|DOC-\d+/.exec(row)?.[0];
    if (key !== undefined && !rows.has(key)) rows.set(key, row);
  }
  return rows;
}

function variants(html: string): string[] {
  return [...html.matchAll(/data-variant="([^"]+)"/g)].map((m) => m[1] ?? "");
}

function panelText(html: string): string {
  return text(html.split("<aside")[1] ?? "");
}

describe("Tickets 화면", () => {
  it("티켓이 하나도 없으면 쉬는 반장을 장식으로 두고, 티켓이 있으면 두지 않는다(0077)", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    const empty = render({ ...page, tickets: [], errors: [] });
    expect(empty).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-mascot="resting"/);
    expect(render(page, { filter: "done" })).not.toContain("data-mascot");
  });

  it("행은 키 · 제목 · 마지막 런이고, 트래커 상태는 행에 두지 않는다", async () => {
    const { context } = setupTickets();
    const rows = rowTexts(render(await loadTicketsPage(context, undefined, now)));
    expect(rows.get("ACME-1")).toContain("Merged");
    expect(rows.get("ACME-2")).toContain("Human Check");
    expect(rows.get("ACME-3")).toContain("Running");
    expect(rows.get("ACME-4")).toContain("Queued");
    expect(rows.get("ACME-5")).toContain("Waiting for Input");
    expect(rows.get("ACME-6")).toContain("할당 전");
    expect(rows.get("ACME-6")).not.toContain("Todo");
  });

  it("머리는 Tickets 와 할당할 수 있는 티켓 수 요약이다", async () => {
    const { context } = setupTickets();
    const html = render(await loadTicketsPage(context, undefined, now));
    const heading = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "";
    expect(text(heading).trim()).toBe("Tickets");
    expect(text(html)).toContain("할당할 수 있는 티켓이 2개 있어요.");
  });

  it("필터는 한 줄 묶음 탭이고 각 개수를 보인다", async () => {
    const { context } = setupTickets();
    const html = render(await loadTicketsPage(context, undefined, now));
    const tabs = [...html.matchAll(/role="tab"[^>]*>([\s\S]*?)<\/button>/g)].map((m) =>
      text(m[1] ?? "").trim(),
    );
    expect(tabs).toEqual(["모두 7", "할당할 수 있음 2", "처리할 일 2", "진행 중 2", "끝남 1"]);
  });

  it.each<[TicketFilter, string[]]>([
    ["all", ["ACME-6", "ACME-5", "ACME-4", "ACME-3", "ACME-2", "ACME-1", "DOC-1"]],
    ["assignable", ["ACME-6", "DOC-1"]],
    ["todo", ["ACME-5", "ACME-2"]],
    ["in-progress", ["ACME-4", "ACME-3"]],
    ["done", ["ACME-1"]],
  ])("필터 %s 는 그 티켓만 목록에 보인다", async (filter, keys) => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    expect([...rowTexts(render(page, { filter })).keys()]).toEqual(keys);
  });

  it("트래커 프로젝트 열은 트래커 프로젝트가 둘 이상일 때만 보인다", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    expect(page.trackerProjectCount).toBe(3);
    expect(rowTexts(render(page)).get("ACME-6")).toContain("Web");
    expect(text(render(page))).toContain("트래커 프로젝트");
    const single = render({ ...page, trackerProjectCount: 1 });
    expect(rowTexts(single).get("ACME-6")).not.toContain("Web");
    expect(text(single.split("<aside")[0] ?? "")).not.toContain("트래커 프로젝트");
  });

  it("읽지 못한 트래커 프로젝트를 알린다", async () => {
    const { context } = setupTickets();
    const html = render(await loadTicketsPage(context, undefined, now));
    expect(text(html)).toContain("Broken 티켓을 읽지 못했어요. 트래커가 API 키를 받지 않았어요.");
    expect(html).not.toContain('role="alert"');
  });

  it("상한에 닿아 잘린 트래커 프로젝트를 목록 위에 알린다(0054)", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    const html = render({ ...page, truncated: [{ trackerProject: "Web", limit: 1000 }] });
    expect(text(html)).toContain(
      "Web 티켓이 많아 1,000개만 보여요. 나머지는 트래커에서 찾아 주세요.",
    );
    expect(text(render(page))).not.toContain("개만 보여요");
  });

  it("행이 많아도 처음에는 일부만 그린다(0054)", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    const base = page.tickets[0];
    if (base === undefined) throw new Error("no ticket");
    const tickets = Array.from({ length: 1000 }, (_, i) => ({
      ...base,
      id: `t-${i}`,
      key: `ACME-${1000 + i}`,
    }));
    const html = render({ ...page, tickets });
    expect(html.split('role="option"').length - 1).toBeLessThanOrEqual(30);
    expect(text(html)).toContain("1000");
  });

  it("고른 티켓이 필터에서 빠져도 패널은 그 티켓을 보인다(0054)", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    const acme3 = page.tickets.find((t) => t.key === "ACME-3");
    const html = render(page, { filter: "assignable", selectedId: acme3?.id ?? "" });
    expect(panelText(html)).toContain("ACME-3 제목");
    expect(html).not.toMatch(/role="option"[^>]*aria-selected="true"/);
  });

  it("트래커 링크는 새 탭에서 열린다고 알린다", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    const panel = panelText(render(page, { selectedId: page.tickets[0]?.id ?? "" }));
    expect(panel).toContain("트래커에서 열기 ↗");
    expect(render(page, { selectedId: page.tickets[0]?.id ?? "" })).toContain(
      'aria-label="트래커에서 열기 (새 탭에서 열려요)"',
    );
  });

  it("할당 전 티켓은 할당 버튼과 Mapping 기본값을 보인다", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    const panel = panelText(render(page, { selectedId: page.tickets[0]?.id ?? "" }));
    expect(panel).toContain("ACME-6 제목");
    expect(panel).toContain("할당하기");
    expect(panel).toContain("github:acme/web · claude");
    expect(panel).toContain("factory · 자동 할당");
  });

  it("진행 중인 런이 있는 티켓은 할당 버튼 대신 런 보기를 보인다", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    const acme3 = page.tickets.find((t) => t.key === "ACME-3");
    const panel = panelText(render(page, { selectedId: acme3?.id ?? "" }));
    expect(panel).toContain("에이전트가 작업하고 있어요.");
    expect(panel).toContain("런 보기");
    expect(panel).not.toContain("할당하기");
    expect(panel).not.toContain("새 런 시작");
  });

  it("Ended 뒤의 티켓은 새 런을 시작할 수 있다", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    const acme1 = page.tickets.find((t) => t.key === "ACME-1");
    const panel = panelText(render(page, { selectedId: acme1?.id ?? "" }));
    expect(panel).toContain("새 런 시작");
    expect(panel).toContain("런 보기");
    expect(panel).toContain("런 수 2개");
  });

  it("패널은 키 · 트래커 프로젝트 · 트래커 상태 메타 줄과 제목, 마지막 런 상자를 보인다", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    const acme3 = page.tickets.find((t) => t.key === "ACME-3");
    if (acme3 === undefined) throw new Error("no ACME-3");
    const html = render(page, { selectedId: acme3.id });
    const aside = html.split("<aside")[1] ?? "";
    const heading = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(aside)?.[1] ?? "";
    expect(text(heading).trim()).toBe(acme3.title);
    const panel = panelText(html);
    expect(panel).toContain("ACME-3 · Web · Todo");
    expect(aside).toContain('aria-label="마지막 런"');
    expect(panel).toMatch(/Running runner-a · \d+시간 \d+분째/);
    expect(panel).toContain("Mapping github:acme/web · claude");
  });

  it("노란 주 버튼은 화면에 하나 이하다(ADR 0010 6번)", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined, now);
    for (const ticket of page.tickets) {
      const all = variants(render(page, { selectedId: ticket.id }));
      expect(all.filter((v) => v === "primary").length).toBeLessThanOrEqual(1);
    }
    const ready = page.tickets.find((t) => t.assignability.kind === "ready");
    expect(variants(render(page, { selectedId: ready?.id ?? "" }))).toContain("primary");
  });
});

describe("수동 할당 폼", () => {
  const choice = (id: string, overrides: Partial<RunnerChoice> = {}): RunnerChoice => ({
    id,
    name: id,
    online: true,
    assignmentBlocked: false,
    projects: ["p"],
    usageLimits: [],
    ...overrides,
  });
  const runners: RunnerChoice[] = [
    choice("runner-a"),
    choice("runner-b", { online: false }),
    choice("runner-c", { assignmentBlocked: true }),
    choice("runner-d", { projects: ["q"] }),
  ];
  const labels = {
    auto: "auto",
    offline: (n: string) => `${n} offline`,
    blocked: (n: string) => `${n} blocked`,
    limited: (n: string, limit: { provider: string; resetsInMs: number }) =>
      `${n} ${limit.provider} ${limit.resetsInMs}`,
  };

  it("Mapping 기본값으로 채우고 러너 쪽 프로젝트는 읽기 전용이다", () => {
    const html = renderWithMessages(
      <AssignForm
        defaults={{ runnerProject: "github:acme/web", agent: "claude" }}
        runners={runners}
        agents={["codex", "claude"]}
        runner={AUTO_RUNNER}
        agent="claude"
        onRunnerChange={noop}
        onAgentChange={noop}
      />,
      ticketsMessages,
    );
    expect(html).toMatch(/<input[^>]*name="runnerProject"[^>]*>/);
    const input = /<input[^>]*name="runnerProject"[^>]*>/.exec(html)?.[0] ?? "";
    expect(input).toContain('value="github:acme/web"');
    expect(input).toContain("readOnly");
    expect(text(html)).toContain("할당 때 자동으로 고르기");
    expect(text(html)).toContain("Claude Code");
  });

  it("러너 목록: 자동 고르기가 맨 앞, 그 프로젝트가 있는 러너만, 인증이 깨진 러너는 비활성+이유", () => {
    expect(runnerOptionsFor(runners, "p", "claude", labels)).toEqual([
      { value: AUTO_RUNNER, label: "auto" },
      { value: "runner-a", label: "runner-a" },
      { value: "runner-b", label: "runner-b offline" },
      { value: "runner-c", label: "runner-c blocked", disabled: true },
    ]);
  });

  it("고른 에이전트의 공급자 한도에 닿은 러너는 막지 않고 경고만 붙인다", () => {
    const limited = [
      choice("runner-a", { usageLimits: [{ provider: "claude", resetsInMs: 60_000 }] }),
    ];

    expect(runnerOptionsFor(limited, "p", "claude", labels)).toEqual([
      { value: AUTO_RUNNER, label: "auto" },
      { value: "runner-a", label: "runner-a claude 60000" },
    ]);
    expect(runnerOptionsFor(limited, "p", "codex", labels)).toEqual([
      { value: AUTO_RUNNER, label: "auto" },
      { value: "runner-a", label: "runner-a" },
    ]);
  });

  it("한도 경고 문구에 공급자 이름과 풀리는 시간을 보인다", () => {
    const html = renderWithMessages(
      <AssignForm
        defaults={{ runnerProject: "p", agent: "claude" }}
        runners={[
          choice("runner-a", { usageLimits: [{ provider: "claude", resetsInMs: 68 * 60_000 }] }),
        ]}
        agents={["claude"]}
        runner="runner-a"
        agent="claude"
        onRunnerChange={noop}
        onAgentChange={noop}
      />,
      ticketsMessages,
    );
    expect(text(html)).toContain("runner-a · Claude 한도에 닿았어요. 1시간 8분 뒤 풀려요");
  });
});
