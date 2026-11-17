import { describe, expect, it } from "vitest";
import domain from "../../messages/ko/domain.json" with { type: "json" };
import runnersJson from "../../messages/ko/runners.json" with { type: "json" };
import { renderWithMessages } from "../testing/render";
import { addUnreachedCanceledRun, breakGitHubAuth, now, seedDatabase } from "../testing/seed";
import { loadRunnersPage } from "./load";
import { runnersMessages } from "./messages";
import type { RunnersPage } from "./model";
import { RunnersScreen } from "./runners-screen";

const noop = () => {};

function render(page: RunnersPage, selectedId?: string) {
  return renderWithMessages(
    <RunnersScreen page={page} selectedId={selectedId} onSelect={noop} />,
    runnersMessages,
  );
}

/** 목록의 행 하나(role="option")의 글. 태그를 지우고 칸을 나눈다 */
function rowTexts(html: string): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  for (const chunk of html.split('role="option"').slice(1)) {
    // 마지막 행 뒤의 패널(aside)은 뺀다
    const cells = (chunk.split("<aside")[0] ?? "")
      .split(/<[^>]+>/)
      .map((s) => s.trim())
      .filter((s) => s !== "" && !s.includes("="));
    const key = cells[0];
    if (key !== undefined) rows.set(key, cells);
  }
  return rows;
}

/** 상세 패널(aside) 안의 글 */
function panelText(html: string): string {
  const panel = html.split("<aside")[1] ?? "";
  return panel.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

describe("Runners 화면", () => {
  it("행마다 Online/Offline, capacity 사용량, Queued 수, 남은 워크트리 수, 마지막 확인을 보인다", () => {
    const { db } = seedDatabase();
    const rows = rowTexts(render(loadRunnersPage(db, now)));
    expect(rows.get("runner-a")).toEqual(["runner-a", "Online", "4/10", "1개", "2개", "2시간 전"]);
    expect(rows.get("runner-b")).toEqual(["runner-b", "Offline", "0/1", "—", "—", "2시간 전"]);
  });

  it("패널에 capacity 를 쓰는 런과 그 Workspace, 기다리는 런, 남은 워크트리, 프로젝트를 보인다", () => {
    const { db } = seedDatabase();
    const text = panelText(render(loadRunnersPage(db, now), "runner-a"));
    expect(text).toContain("capacity 4/10");
    expect(text).toContain("6개 비어 있어요");
    expect(text).toContain(`Acme Labs · ${domain.runState.running}`);
    // Disconnected 런은 "연결 끊김"으로 보인다
    expect(text).toContain(`ACME-12 Acme Commerce · ${domain.runState.disconnected}`);
    expect(text).toContain("기다리는 런 1");
    expect(text).toContain("남은 워크트리 2");
    expect(text).toContain(runnersJson.panel.worktree["operator-decides"]);
    expect(text).toContain(runnersJson.panel.worktree["keep-until-pr-settles"]);
    expect(text).toContain("프로젝트 1");
    expect(text).toContain("github:acme/web");
  });

  it("런 줄은 그 런의 Workspace 로 연 Runs 로 이어진다", () => {
    const { db, ids } = seedDatabase();
    const html = render(loadRunnersPage(db, now), "runner-a");
    expect(html).toContain(`href="/runs?ws=ws-labs&amp;sel=${ids.get("LAB-1") ?? ""}"`);
  });

  it("Offline 러너는 남은 capacity 를 쓸 수 없다고 보인다", () => {
    const { db } = seedDatabase();
    const text = panelText(render(loadRunnersPage(db, now), "runner-b"));
    expect(text).toContain(runnersJson.panel.reason.offline);
    expect(text).toContain(runnersJson.panel.noFreeCapacity);
    expect(text).toContain(runnersJson.panel.notConfigured);
  });

  it("고른 러너가 없거나 모르는 값이면 첫 러너를 보인다", () => {
    const { db } = seedDatabase();
    const page = loadRunnersPage(db, now);
    expect(panelText(render(page, "nope"))).toContain("capacity 4/10");
  });

  it("GitHub 인증이 깨진 러너는 할당에서 빠졌다고 보이고 깨진 프로젝트와 해결 방법을 보인다(Q82.14·Q82.15)", () => {
    const { db } = seedDatabase();
    breakGitHubAuth(db);
    const html = render(loadRunnersPage(db, now), "runner-a");
    expect(rowTexts(html).get("runner-a")?.slice(1, 3)).toEqual([
      "Online",
      runnersJson.assignmentBlocked,
    ]);
    expect(rowTexts(html).get("runner-b")).not.toContain(runnersJson.assignmentBlocked);
    const text = panelText(html);
    expect(text).toContain(runnersJson.panel.reason.assignmentBlocked);
    // 어댑터의 영어 이름 대신 메시지로 보인다. 러너 쪽 프로젝트에 없는 항목은 프로젝트 ID 를 넣는다
    expect(text).toContain(
      `GitHub push 권한: github:acme/web ${runnersJson.panel.githubAuth.state.broken}`,
    );
    expect(text).toContain(
      `GitHub push 권한: github:acme/docs ${runnersJson.panel.githubAuth.state.ok}`,
    );
    expect(text).not.toContain("GitHub push access");
    // 어댑터의 영어 해결 방법은 한국어 안내와 겹쳐 보이지 않는다
    expect(text).not.toContain("Run `gh auth login");
    expect(text).toContain("gh auth login --insecure-storage");
    expect(text).toContain("gh auth setup-git");
  });

  it("인증을 아직 확인하지 않은 러너는 그렇다고 보이고 해결 방법은 보이지 않는다", () => {
    const { db } = seedDatabase();
    const text = panelText(render(loadRunnersPage(db, now), "runner-a"));
    expect(text).toContain(runnersJson.panel.githubAuth.neverChecked);
    expect(text).not.toContain("gh auth login");
  });

  it("러너에 닿지 못한 채 끝난 취소 런을 남은 워크트리 수에 넣는다(Q82.21)", () => {
    const { db } = seedDatabase();
    addUnreachedCanceledRun(db, "ACME-22");
    const html = render(loadRunnersPage(db, now), "runner-b");
    expect(rowTexts(html).get("runner-b")?.[4]).toBe("1개");
    expect(panelText(html)).toContain(
      `ACME-22 Acme Commerce · ${runnersJson.panel.worktree["operator-decides"]}`,
    );
  });

  it("러너가 없으면 빈 목록 문구를 보인다", () => {
    expect(render({ runners: [] })).toContain(runnersJson.noRunners);
  });
});
