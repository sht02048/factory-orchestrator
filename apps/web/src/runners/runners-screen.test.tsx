import { describe, expect, it } from "vitest";
import domain from "../../messages/ko/domain.json" with { type: "json" };
import runnersJson from "../../messages/ko/runners.json" with { type: "json" };
import { renderWithMessages } from "../testing/render";
import { now, seedDatabase } from "../testing/seed";
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

  it("러너가 없으면 빈 목록 문구를 보인다", () => {
    expect(render({ runners: [] })).toContain(runnersJson.noRunners);
  });
});
