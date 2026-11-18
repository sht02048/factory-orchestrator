import { describe, expect, it } from "vitest";
import domain from "../../messages/ko/domain.json" with { type: "json" };
import runnersJson from "../../messages/ko/runners.json" with { type: "json" };
import { pillsOf } from "../testing/pills";
import { renderWithMessages } from "../testing/render";
import { addUnreachedCanceledRun, breakGitHubAuth, now, seedDatabase } from "../testing/seed";
import { loadRunnersPage } from "./load";
import { runnersMessages } from "./messages";
import type { RunnersPage } from "./model";
import { ADD_RUNNER_HREF, RunnersScreen } from "./runners-screen";

const card = runnersJson.card;

function render(page: RunnersPage, selectedId?: string) {
  return renderWithMessages(<RunnersScreen page={page} selectedId={selectedId} />, runnersMessages);
}

/** 러너 카드 하나(section)의 HTML */
function cardHtml(html: string, name: string): string {
  const start = html.indexOf(`<section aria-label="${name} 러너"`);
  if (start === -1) throw new Error(`no card ${name}`);
  return html.slice(start, html.indexOf("</section>", start));
}

/** 태그를 지운 글 */
function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
}

/** 렌더한 버튼(과 버튼 모양 링크)의 변형 */
function variantsOf(html: string): string[] {
  return [...html.matchAll(/data-variant="([^"]+)"/g)].map((m) => m[1] ?? "");
}

describe("Runners 화면", () => {
  it('러너마다 카드를 그리고 Online·Offline 알약과 capacity "n/m"을 보인다', () => {
    const { db } = seedDatabase();
    const html = render(loadRunnersPage(db, now));
    const a = cardHtml(html, "runner-a");
    expect(pillsOf(a)[0]).toEqual({ status: "online", label: domain.runnerState.online });
    expect(textOf(a)).toContain(`${card.capacity} 4/10`);
    const b = cardHtml(html, "runner-b");
    expect(pillsOf(b)[0]).toEqual({ status: "offline", label: domain.runnerState.offline });
    expect(textOf(b)).toContain(`${card.capacity} 0/1`);
  });

  it("제목 아래 한 줄 요약에 새 런을 받을 수 있는 러너 수와 문제가 있는 러너 수를 보인다", () => {
    const { db } = seedDatabase();
    const text = textOf(render(loadRunnersPage(db, now)));
    expect(text).toContain("2대 중 1대가 새 런을 받을 수 있어요. 1대는 문제가 있어요.");
  });

  it("파란 주 버튼은 러너 추가 하나이고 Settings 의 러너 등록으로 간다(ADR 0010 6번)", () => {
    const { db } = seedDatabase();
    breakGitHubAuth(db);
    const html = render(loadRunnersPage(db, now));
    expect(variantsOf(html).filter((v) => v === "primary")).toHaveLength(1);
    expect(html).toContain(`<a href="${ADD_RUNNER_HREF}" data-variant="primary"`);
    expect(textOf(html)).toContain(runnersJson.add);
  });

  it("러너가 없어도 주 버튼은 하나다", () => {
    const html = render({ runners: [] });
    expect(textOf(html)).toContain(runnersJson.noRunners);
    expect(variantsOf(html)).toEqual(["primary"]);
  });

  it("capacity 를 쓰는 런과 기다리는 런을 상태 알약·Workspace 와 함께 보인다", () => {
    const { db } = seedDatabase();
    const a = cardHtml(render(loadRunnersPage(db, now)), "runner-a");
    const statuses = pillsOf(a).map((p) => p.status);
    expect(statuses).toContain("running");
    expect(statuses).toContain("disconnected");
    expect(statuses).toContain("queued");
    expect(textOf(a)).toContain("ACME-12 Acme Commerce");
    expect(textOf(a)).toContain("6자리가 비어 있어요.");
  });

  it("런 줄은 그 런의 Workspace 로 연 Runs 로 이어진다", () => {
    const { db, ids } = seedDatabase();
    const html = render(loadRunnersPage(db, now));
    expect(html).toContain(`href="/runs?ws=ws-labs&amp;sel=${ids.get("LAB-1") ?? ""}"`);
  });

  it("남은 워크트리와 그 까닭을 보인다", () => {
    const { db } = seedDatabase();
    const text = textOf(cardHtml(render(loadRunnersPage(db, now)), "runner-a"));
    expect(text).toContain("남은 워크트리 2");
    expect(text).toContain(card.worktree["operator-decides"]);
    expect(text).toContain(card.worktree["keep-until-pr-settles"]);
  });

  it("Offline 러너는 닿지 않는다는 것과 해결 안내를 보이고 막대를 빨갛게 그린다", () => {
    const { db } = seedDatabase();
    const b = cardHtml(render(loadRunnersPage(db, now)), "runner-b");
    const text = textOf(b);
    expect(text).toContain(card.summary.offline);
    expect(text).toContain(card.unreachable);
    expect(text).toContain(card.fixTitle);
    expect(text).toContain(card.fix.offline);
    // Offline 은 Offline 알약 하나로 보인다. Runner Issue 알약을 겹쳐 달지 않는다
    expect(pillsOf(b).map((p) => p.status)).toEqual(["offline"]);
  });

  it("GitHub 인증이 깨진 러너는 Online 과 Runner Issue 알약, 깨진 프로젝트, 해결 방법을 보인다(Q82.14·Q82.15)", () => {
    const { db } = seedDatabase();
    breakGitHubAuth(db);
    const html = render(loadRunnersPage(db, now));
    const a = cardHtml(html, "runner-a");
    expect(pillsOf(a).slice(0, 2)).toEqual([
      { status: "online", label: domain.runnerState.online },
      { status: "runner-issue", label: domain.attention["runner-issue"] },
    ]);
    const text = textOf(a);
    expect(text).toContain(card.summary.assignmentBlocked);
    // 항목마다 통과·깨짐을 아이콘 이름으로 보인다. 어댑터의 영어 이름 대신 메시지로 보인다
    expect(a).toMatch(
      new RegExp(`aria-label="${card.check.broken}"[^]*?GitHub push 권한: github:acme/web<`),
    );
    expect(a).toMatch(
      new RegExp(`aria-label="${card.check.ok}"[^]*?GitHub push 권한: github:acme/docs<`),
    );
    expect(text).not.toContain("GitHub push access");
    // 어댑터의 영어 해결 방법은 한국어 안내와 겹쳐 보이지 않는다
    expect(text).not.toContain("Run `gh auth login");
    expect(text).toContain("gh auth login --insecure-storage");
    expect(text).toContain("gh auth setup-git");
    expect(pillsOf(cardHtml(html, "runner-b")).map((p) => p.status)).toEqual(["offline"]);
  });

  it("확인 항목을 아직 읽지 않은 러너는 그렇다고 보이고 해결 방법은 보이지 않는다", () => {
    const { db } = seedDatabase();
    const text = textOf(cardHtml(render(loadRunnersPage(db, now)), "runner-a"));
    expect(text).toContain(card.noChecks);
    expect(text).not.toContain(card.fixTitle);
  });

  it("마지막 확인을 상대 시간으로 보인다", () => {
    const { db } = seedDatabase();
    const text = textOf(cardHtml(render(loadRunnersPage(db, now)), "runner-a"));
    expect(text).toContain("2시간 전 확인했어요");
  });

  it("러너에 닿지 못한 채 끝난 취소 런을 남은 워크트리에 넣는다(Q82.21)", () => {
    const { db } = seedDatabase();
    addUnreachedCanceledRun(db, "ACME-22");
    const text = textOf(cardHtml(render(loadRunnersPage(db, now)), "runner-b"));
    expect(text).toContain("남은 워크트리 1");
    expect(text).toContain(`ACME-22 Acme Commerce · ${card.worktree["operator-decides"]}`);
  });

  it("카드마다 주소로 고를 수 있는 id 를 단다", () => {
    const { db } = seedDatabase();
    const html = render(loadRunnersPage(db, now), "runner-b");
    expect(html).toContain('id="runner-runner-a"');
    expect(html).toContain('id="runner-runner-b"');
  });
});
