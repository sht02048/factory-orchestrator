import { describe, expect, it } from "vitest";
import domain from "../../messages/ko/domain.json" with { type: "json" };
import runnersJson from "../../messages/ko/runners.json" with { type: "json" };
import { pillsOf } from "../testing/pills";
import { renderWithMessages } from "../testing/render";
import { recordRunnerCheck } from "@factory/db";
import { toRunnerId } from "@factory/core";
import { addUnreachedCanceledRun, breakGitHubAuth, now, seedDatabase } from "../testing/seed";
import { loadRunnersPage } from "./load";
import { runnersMessages } from "./messages";
import { failedChecksFirst, problemRunnersFirst } from "./model";
import type { RunnerView, RunnersPage } from "./model";
import { addRunnerHref, RunnersScreen } from "./runners-screen";
import type { RunnerActions } from "./runners-screen";

const panel = runnersJson.panel;

const noActions: RunnerActions = {
  recheck: () => Promise.resolve({ ok: true }),
  pollChecks: () => Promise.resolve(false),
};

function render(page: RunnersPage, selectedId?: string, ws?: string) {
  return renderWithMessages(
    <RunnersScreen
      page={page}
      selectedId={selectedId}
      ws={ws}
      onSelect={() => undefined}
      actions={noActions}
    />,
    runnersMessages,
  );
}

function rowsOf(html: string): { name: string; html: string; selected: boolean }[] {
  return html
    .split('role="option"')
    .slice(1)
    .map((chunk) => {
      const end = chunk.indexOf("<aside");
      const row = end === -1 ? chunk : chunk.slice(0, end);
      return {
        name: /id="runner-([^"]+)"/.exec(row)?.[1] ?? "",
        html: row,
        selected: /^[^>]*aria-selected="true"/.test(row),
      };
    });
}

function panelHtml(html: string): string {
  const start = html.indexOf(`<section aria-label="${panel.label}"`);
  if (start === -1) throw new Error("no panel");
  return html.slice(start);
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
}

function variantsOf(html: string): string[] {
  return [...html.matchAll(/data-variant="([^"]+)"/g)].map((m) => m[1] ?? "");
}

function runner(overrides: Partial<RunnerView> & { id: string }): RunnerView {
  return {
    name: overrides.id,
    online: true,
    assignmentBlocked: false,
    checks: null,
    checked: null,
    capacity: 2,
    occupying: [],
    queued: [],
    leftWorktrees: [],
    sshTarget: null,
    ...overrides,
  };
}

const callout = /<section aria-labelledby=/;

describe("Runners 목록", () => {
  it("문제 있는 러너(Offline·Runner Issue)를 Online 러너보다 위에 두고 그 안의 순서는 지킨다", () => {
    const page: RunnersPage = {
      runners: [
        runner({ id: "ok-1" }),
        runner({ id: "down", online: false }),
        runner({ id: "ok-2" }),
        runner({ id: "auth", assignmentBlocked: true }),
      ],
    };
    expect(rowsOf(render(page)).map((r) => r.name)).toEqual(["down", "auth", "ok-1", "ok-2"]);
    expect(problemRunnersFirst(page.runners).map((r) => r.id)).toEqual([
      "down",
      "auth",
      "ok-1",
      "ok-2",
    ]);
  });

  it("행마다 상태 알약은 하나다: Offline 이면 Offline, 인증이 깨지면 Runner Issue, 아니면 Online", () => {
    const { db } = seedDatabase();
    breakGitHubAuth(db);
    const page = loadRunnersPage(db, now);
    page.runners.push(runner({ id: "runner-c" }));
    const rows = rowsOf(render(page));
    expect(rows.map((r) => [r.name, pillsOf(r.html)])).toEqual([
      ["runner-a", [{ status: "runner-issue", label: domain.attention["runner-issue"] }]],
      ["runner-b", [{ status: "offline", label: domain.runnerState.offline }]],
      ["runner-c", [{ status: "online", label: domain.runnerState.online }]],
    ]);
  });

  it('행에 이름·주소와 capacity 막대 "n/m", 그 아래 무엇이 문제인지 한 문장을 보인다', () => {
    const { db } = seedDatabase();
    breakGitHubAuth(db);
    const rows = rowsOf(render(loadRunnersPage(db, now)));
    const a = rows.find((r) => r.name === "runner-a")?.html ?? "";
    expect(a).toMatch(/role="meter"[^>]*aria-valuetext="4\/10"/);
    expect(a).toContain('data-tone="problem"');
    expect(textOf(a)).toContain(`runner-a ${runnersJson.row.assignmentBlocked}`);
    const b = rows.find((r) => r.name === "runner-b")?.html ?? "";
    expect(textOf(b)).toContain(runnersJson.row.offline);
  });

  it("꽉 찬 러너는 자리를 기다리는 런 수를, 빈자리가 있으면 빈자리 수를 한 문장으로 보인다", () => {
    const occupying = [
      {
        id: "r1",
        ticketKey: "ACME-1",
        workspace: { id: "ws", name: "Acme" },
        state: "running" as const,
        executionMs: 1000,
      },
    ];
    const queued = [
      { id: "q1", ticketKey: "ACME-2", workspace: { id: "ws", name: "Acme" }, waitMs: 1000 },
      { id: "q2", ticketKey: "ACME-3", workspace: { id: "ws", name: "Acme" }, waitMs: 1000 },
    ];
    const rows = rowsOf(
      render({
        runners: [
          runner({
            id: "full",
            capacity: 1,
            occupying,
            queued,
            sshTarget: "dev@runner.example.com",
          }),
          runner({ id: "free", capacity: 3, occupying }),
        ],
      }),
    );
    expect(textOf(rows[0]?.html ?? "")).toContain("꽉 찼어요. 런 2개가 자리를 기다려요.");
    expect(rows[0]?.html).toContain("dev@runner.example.com");
    expect(rows[0]?.html).toContain('data-tone="progress"');
    expect(textOf(rows[1]?.html ?? "")).toContain("2자리가 비어 있어요.");
  });

  it("제목 아래 한 줄 요약에 문제 있는 러너 수와 새 런을 받을 수 있는 러너 수를 보인다", () => {
    const { db } = seedDatabase();
    expect(textOf(render(loadRunnersPage(db, now)))).toContain(
      "2대 중 1대에 문제가 있어요. 1대가 지금 새 런을 받을 수 있어요.",
    );
    breakGitHubAuth(db);
    expect(textOf(render(loadRunnersPage(db, now)))).toContain(
      "2대 중 2대에 문제가 있어요. 지금 새 런을 받을 수 있는 러너가 없어요.",
    );
    expect(textOf(render({ runners: [runner({ id: "ok" })] }))).toContain(
      "러너 1대 모두 문제가 없어요. 1대가 지금 새 런을 받을 수 있어요.",
    );
  });

  it("파란 주 버튼은 러너 추가 하나이고 Settings 의 러너 등록으로 간다(ADR 0010 6번)", () => {
    const { db } = seedDatabase();
    breakGitHubAuth(db);
    const html = render(loadRunnersPage(db, now));
    expect(variantsOf(html).filter((v) => v === "primary")).toHaveLength(1);
    expect(html).toContain(`<a href="/settings?sel=runners" data-variant="primary"`);
  });

  it("러너 추가 링크는 보던 Workspace(ws)를 이어 간다", () => {
    expect(addRunnerHref("ws-labs")).toBe("/settings?ws=ws-labs&sel=runners");
    const { db } = seedDatabase();
    expect(render(loadRunnersPage(db, now), undefined, "ws-labs")).toContain(
      'href="/settings?ws=ws-labs&amp;sel=runners"',
    );
  });

  it("러너가 없으면 빈 상태로 안내하고 목록과 패널 내용은 그리지 않는다", () => {
    const html = render({ runners: [] });
    const text = textOf(html);
    expect(text).toContain(runnersJson.empty.title);
    expect(text).toContain(runnersJson.empty.body);
    expect(/<header[^]*?<\/header>/.exec(html)?.[0]).not.toContain("<p");
    expect(html).not.toContain('role="listbox"');
    expect(variantsOf(html)).toEqual(["primary"]);
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-mascot="resting"/);
  });

  it("러너가 있으면 마스코트를 두지 않는다(0077)", () => {
    expect(render(loadRunnersPage(seedDatabase().db, now))).not.toContain("data-mascot");
  });
});

describe("Runners 고른 러너 패널", () => {
  it("sel 로 고른 러너를 고르고, sel 이 없으면 맨 위 러너를 고른다", () => {
    const { db } = seedDatabase();
    const page = loadRunnersPage(db, now);
    const chosen = rowsOf(render(page, "runner-a")).filter((r) => r.selected);
    expect(chosen.map((r) => r.name)).toEqual(["runner-a"]);
    expect(render(page, "runner-a")).toMatch(/<h2[^>]*>runner-a<\/h2>/);
    expect(
      rowsOf(render(page))
        .filter((r) => r.selected)
        .map((r) => r.name),
    ).toEqual(["runner-b"]);
    expect(
      rowsOf(render(page, "missing"))
        .filter((r) => r.selected)
        .map((r) => r.name),
    ).toEqual(["runner-b"]);
  });

  it("해결 상자는 문제 있는 러너에만 보이고 제목·번호 단계·다시 확인 버튼을 담는다", () => {
    const { db } = seedDatabase();
    const page = loadRunnersPage(db, now);
    const offline = panelHtml(render(page, "runner-b"));
    expect(offline).toMatch(callout);
    expect(textOf(offline)).toContain(panel.fix.offline.title);
    expect(offline).toMatch(/<ol[^>]*><li[^]*?1<\/span>[^]*?2<\/span>[^]*?3<\/span>/);
    expect(textOf(offline)).toContain(panel.fix.offline.steps["1"]);
    expect(offline).toMatch(new RegExp(`data-variant="secondary"[^>]*>${panel.recheck}</button>`));

    const online = panelHtml(render(page, "runner-a"));
    expect(online).not.toMatch(callout);
    expect(textOf(online)).not.toContain(panel.recheck);
  });

  it("GitHub 인증이 깨진 러너의 해결 상자는 gh 명령을 모노 글로 단계에 담는다", () => {
    const { db } = seedDatabase();
    breakGitHubAuth(db);
    const a = panelHtml(render(loadRunnersPage(db, now), "runner-a"));
    expect(a).toMatch(callout);
    expect(textOf(a)).toContain(panel.fix.assignmentBlocked.title);
    expect(a).toMatch(/<code[^>]*>gh auth login --insecure-storage<\/code>/);
    expect(a).toMatch(/<code[^>]*>gh auth setup-git<\/code>/);
  });

  it("상태 알약·확인 시각, 제목 이름과 주소를 패널 머리에 둔다", () => {
    const html = panelHtml(
      render({
        runners: [
          runner({
            id: "r",
            name: "build-1",
            sshTarget: "dev@runner.example.com",
            checked: { at: now.toISOString(), agoMs: 2 * 60 * 60 * 1000 },
          }),
        ],
      }),
    );
    expect(pillsOf(html)[0]).toEqual({ status: "online", label: domain.runnerState.online });
    expect(textOf(html)).toContain("2시간 전 확인했어요");
    expect(html).toMatch(/<h2[^>]*>build-1<\/h2>/);
    expect(html).toMatch(/<p[^>]*>dev@runner.example.com<\/p>/);
  });

  it("지금 하는 런 블록은 n/capacity 와 쓰는 런·기다리는 런을 Run 상세 링크로 보인다", () => {
    const { db, ids } = seedDatabase();
    const a = panelHtml(render(loadRunnersPage(db, now), "runner-a"));
    expect(textOf(a)).toContain("지금 하는 런 · 4/10");
    const statuses = pillsOf(a).map((p) => p.status);
    expect(statuses).toContain("running");
    expect(statuses).toContain("disconnected");
    expect(statuses).toContain("queued");
    expect(textOf(a)).toContain("ACME-12 Acme Commerce");
    const id = ids.get("LAB-1") ?? "";
    expect(a).toMatch(
      new RegExp(
        `<a href="/runs/${id}\\?ws=ws-labs"[^>]*>(?:(?!</a>)[^])*LAB-1(?:(?!</a>)[^])*</a>`,
      ),
    );
    expect(textOf(panelHtml(render(loadRunnersPage(db, now), "runner-b")))).toContain(panel.noRuns);
  });

  it("확인 항목은 통과 수/전체를 제목에 두고 깨진 항목을 먼저 보인다", () => {
    const { db } = seedDatabase();
    breakGitHubAuth(db);
    const a = panelHtml(render(loadRunnersPage(db, now), "runner-a"));
    expect(textOf(a)).toContain("확인 항목 · 2/3 통과");
    const states = [...a.matchAll(/data-check="([^"]+)"/g)].map((m) => m[1]);
    expect(states).toEqual(["broken", "ok", "ok"]);
    expect(a).toMatch(
      new RegExp(
        `data-check="broken"[^]*?${panel.check.broken}[^]*?GitHub push 권한: github:acme/web<`,
      ),
    );
    expect(textOf(a)).not.toContain("GitHub push access");
    const lines = [...a.matchAll(/<li data-check="([^"]+)"[^]*?<\/li>/g)].map((m) => [
      m[1],
      textOf(m[0]).trim(),
    ]);
    expect(lines).toEqual([
      ["broken", `${panel.check.broken} GitHub push 권한: github:acme/web`],
      ["ok", "Orca service"],
      ["ok", "GitHub push 권한: github:acme/docs"],
    ]);
    expect(a).not.toContain('data-status="online" data-tone');
  });

  it("확인하지 못한 항목은 그렇다고 글로 보인다", () => {
    const html = panelHtml(
      render({
        runners: [
          runner({
            id: "r",
            checks: [
              {
                id: "x",
                name: "Orca service",
                project: null,
                satisfied: null,
                blocksAssignment: false,
                hint: null,
              },
            ],
          }),
        ],
      }),
    );
    expect(textOf(html)).toContain("확인 항목 · 0/1 통과");
    expect(html).toMatch(new RegExp(`data-check="unknown"[^]*?${panel.check.unknown}`));
  });

  it("깨진 항목 아래에 어댑터의 해결 안내를 보인다", () => {
    const { db } = seedDatabase();
    recordRunnerCheck(db, {
      runnerId: toRunnerId("runner-a"),
      online: true,
      checkedAt: now,
      error: null,
      projects: null,
      assignmentBlocked: false,
      prerequisites: [
        {
          id: "orca-service",
          name: "Orca service",
          satisfied: false,
          hint: "orca serve service install",
          blocksAssignment: false,
        },
      ],
    });
    const a = panelHtml(render(loadRunnersPage(db, now), "runner-a"));
    expect(textOf(a)).toContain("확인 항목 · 0/1 통과");
    expect(textOf(a)).toContain("Orca 상시 서비스 orca serve service install");
    expect(a).not.toMatch(callout);
  });

  it("Offline 러너는 확인 항목 대신 ssh로 닿지 않는다고 보인다", () => {
    const { db } = seedDatabase();
    const b = panelHtml(render(loadRunnersPage(db, now), "runner-b"));
    expect(textOf(b)).toContain(`${panel.checksTitle} ${panel.check.broken} ${panel.unreachable}`);
  });

  it("확인 항목을 아직 읽지 않은 러너는 그렇다고 보인다", () => {
    const { db } = seedDatabase();
    const a = panelHtml(render(loadRunnersPage(db, now), "runner-a"));
    expect(textOf(a)).toContain(`${panel.checksTitle} ${panel.noChecks}`);
  });

  it("남은 워크트리와 그 까닭을 보인다", () => {
    const { db } = seedDatabase();
    const text = textOf(panelHtml(render(loadRunnersPage(db, now), "runner-a")));
    expect(text).toContain("남은 워크트리 2");
    expect(text).toContain(panel.worktree["operator-decides"]);
    expect(text).toContain(panel.worktree["keep-until-pr-settles"]);
  });

  it("러너에 닿지 못한 채 끝난 취소 런을 남은 워크트리에 넣는다(Q82.21)", () => {
    const { db } = seedDatabase();
    addUnreachedCanceledRun(db, "ACME-22");
    const text = textOf(panelHtml(render(loadRunnersPage(db, now), "runner-b")));
    expect(text).toContain("남은 워크트리 1");
    expect(text).toContain(`ACME-22 Acme Commerce · ${panel.worktree["operator-decides"]}`);
  });

  it("확인 항목 정렬은 깨짐, 모름, 통과 순이다", () => {
    expect(
      failedChecksFirst([
        { id: "a", satisfied: true },
        { id: "b", satisfied: null },
        { id: "c", satisfied: false },
      ]).map((c) => c.id),
    ).toEqual(["c", "b", "a"]);
  });
});
