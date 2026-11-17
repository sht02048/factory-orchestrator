import { describe, expect, it } from "vitest";
import { renderWithMessages } from "../testing/render";
import { AUTO_RUNNER, AssignForm, runnerOptionsFor } from "./assign-dialog";
import { loadTicketsPage } from "./load";
import { ticketsMessages } from "./messages";
import type { RunnerChoice, TicketFilter, TicketsPage } from "./model";
import { setupTickets } from "./test-fixtures";
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
    />,
    ticketsMessages,
  );
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

/** 목록의 행(role="option")마다 칸 글 */
function rowTexts(html: string): Map<string, string> {
  const rows = new Map<string, string>();
  for (const chunk of html.split('role="option"').slice(1)) {
    const row = text(chunk.split("</button>")[0] ?? chunk);
    const key = /ACME-\d+|DOC-\d+/.exec(row)?.[0];
    if (key !== undefined && !rows.has(key)) rows.set(key, row);
  }
  return rows;
}

function panelText(html: string): string {
  return text(html.split("<aside")[1] ?? "");
}

describe("Tickets 화면", () => {
  it("티켓마다 트래커 프로젝트·상태와 마지막 런 결과를 보인다", async () => {
    const { context } = setupTickets();
    const rows = rowTexts(render(await loadTicketsPage(context, undefined)));
    expect(rows.get("ACME-1")).toContain("Merged");
    expect(rows.get("ACME-2")).toContain("Human Check");
    expect(rows.get("ACME-3")).toContain("실행 중");
    expect(rows.get("ACME-4")).toContain("Queued");
    expect(rows.get("ACME-5")).toContain("입력 기다림");
    expect(rows.get("ACME-6")).toContain("할당 전");
    expect(rows.get("ACME-6")).toContain("Web");
    expect(rows.get("ACME-6")).toContain("Todo");
  });

  it("읽지 못한 트래커 프로젝트를 알린다", async () => {
    const { context } = setupTickets();
    const html = render(await loadTicketsPage(context, undefined));
    expect(text(html)).toContain("Broken 티켓을 읽지 못했어요. 트래커가 API 키를 받지 않았어요.");
  });

  it("할당 전 티켓은 할당 버튼과 Mapping 기본값을 보인다", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined);
    const panel = panelText(render(page, { selectedId: page.tickets[0]?.id ?? "" }));
    expect(panel).toContain("ACME-6 제목");
    expect(panel).toContain("할당하기");
    expect(panel).toContain("github:acme/web · claude");
    expect(panel).toContain("factory · 자동 할당");
  });

  it("진행 중인 런이 있는 티켓은 할당 버튼 대신 런 보기를 보인다", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined);
    const acme3 = page.tickets.find((t) => t.key === "ACME-3");
    const panel = panelText(render(page, { selectedId: acme3?.id ?? "" }));
    expect(panel).toContain("진행 중이거나 Queued인 런이 있어 새로 할당할 수 없어요");
    expect(panel).toContain("런 보기");
    expect(panel).not.toContain("할당하기");
    expect(panel).not.toContain("새 런 시작");
  });

  it("Ended 뒤의 티켓은 새 런을 시작할 수 있다", async () => {
    const { context } = setupTickets();
    const page = await loadTicketsPage(context, undefined);
    const acme1 = page.tickets.find((t) => t.key === "ACME-1");
    const panel = panelText(render(page, { selectedId: acme1?.id ?? "" }));
    expect(panel).toContain("새 런 시작");
    expect(panel).toContain("런 2개");
  });
});

describe("수동 할당 폼", () => {
  const runners: RunnerChoice[] = [
    { id: "runner-a", name: "runner-a", online: true, assignmentBlocked: false, projects: ["p"] },
    { id: "runner-b", name: "runner-b", online: false, assignmentBlocked: false, projects: ["p"] },
    { id: "runner-c", name: "runner-c", online: true, assignmentBlocked: true, projects: ["p"] },
    { id: "runner-d", name: "runner-d", online: true, assignmentBlocked: false, projects: ["q"] },
  ];

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
    expect(
      runnerOptionsFor(runners, "p", {
        auto: "auto",
        offline: (n) => `${n} offline`,
        blocked: (n) => `${n} blocked`,
      }),
    ).toEqual([
      { value: AUTO_RUNNER, label: "auto" },
      { value: "runner-a", label: "runner-a" },
      { value: "runner-b", label: "runner-b offline" },
      { value: "runner-c", label: "runner-c blocked", disabled: true },
    ]);
  });
});
