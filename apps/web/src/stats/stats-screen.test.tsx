import { describe, expect, it } from "vitest";
import { renderWithMessages } from "../testing/render";
import { addRunDecisionCases, now, seedStatsDatabase } from "../testing/stats-seed";
import { loadStatsPage } from "./load";
import { statsMessages } from "./messages";
import type { StatsDimension, StatsPage } from "./model";
import { StatsScreen } from "./stats-screen";

const noop = () => {};

function render(
  page: StatsPage,
  options: { dimension?: StatsDimension; selectedKey?: string } = {},
) {
  return renderWithMessages(
    <StatsScreen
      page={page}
      workspaces={[
        { id: "ws-commerce", name: "Acme Commerce" },
        { id: "ws-labs", name: "Acme Labs" },
      ]}
      dimension={options.dimension ?? "runner"}
      selectedKey={options.selectedKey}
      onDimensionChange={noop}
      onSelect={noop}
      onPickWorkspace={noop}
    />,
    statsMessages,
  );
}

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

/** 목록의 행 하나(role="option")의 칸 글 */
function rowTexts(html: string): string[][] {
  const list = html.split("<aside")[0] ?? "";
  return list
    .split('role="option"')
    .slice(1)
    .map((chunk) =>
      chunk
        .split(/<[^>]+>/)
        .map((s) => s.trim())
        .filter((s) => s !== "" && !s.includes("=")),
    );
}

/** 상세 패널(aside) 안의 글 */
function panelText(html: string): string {
  const aside = html.split("<aside")[1] ?? "";
  return text(aside.slice(aside.indexOf(">") + 1));
}

describe("Stats 화면", () => {
  it("기간 요약에 끝난 런, Merged 비율, 손댈 일, 리드 타임, Human Check 뒤 병합을 보인다", () => {
    const html = text(render(loadStatsPage(seedStatsDatabase(), undefined, now)));
    expect(html).toContain("Acme Commerce · 최근 14일(11월 4일–11월 17일)");
    expect(html).toContain("9 끝난 런");
    expect(html).toContain("22% Merged");
    expect(html).toContain("7 Human Check 3 · Failed 4");
    expect(html).toContain("22분 리드 타임 중앙값 · p90 2시간 1분 대기 4분 · 실행 20분");
    expect(html).toContain("33% Human Check 뒤 병합 Human Check 3개 중 1개");
  });

  it("Failed 조합을 에이전트 결과 · PR 상태로 보인다", () => {
    const html = text(render(loadStatsPage(seedStatsDatabase(), undefined, now)));
    expect(html).toContain("완료 보고(실패) · PR 없음 2개");
    expect(html).toContain("완료 보고(성공) · PR 닫힘 1개");
    expect(html).toContain("시간 초과 · PR 열림 1개");
  });

  it("날짜별 처리량 막대에 날마다 요약 결과 수를 단다", () => {
    const html = render(loadStatsPage(seedStatsDatabase(), undefined, now));
    expect(html).toContain(
      "<title>11월 16일: Merged 1 · Human Check 1 · Failed 0 · 취소 0</title>",
    );
    expect(html.match(/<title>/g)).toHaveLength(14);
  });

  it("나눠 보기 행에 런, Merged 비율, Human Check, Failed, 취소, 리드 타임을 보인다", () => {
    const page = loadStatsPage(seedStatsDatabase(), undefined, now);
    expect(rowTexts(render(page))).toEqual([
      ["runner-a", "5", "40%", "2", "1", "0", "22분"],
      ["runner-b", "4", "0%", "1", "3", "0", "18분"],
    ]);
    expect(rowTexts(render(page, { dimension: "agent" })).map((r) => r[0])).toEqual([
      "claude",
      "codex",
    ]);
  });

  it("고른 묶음의 요약을 패널에 보인다. 고르지 않았으면 첫 행이다", () => {
    const page = loadStatsPage(seedStatsDatabase(), undefined, now);
    const first = panelText(render(page));
    expect(first).toContain("러너별 · 최근 14일");
    expect(first).toContain("runner-a");
    expect(first).toContain(
      "런 5개 중 2개를 에이전트가 병합까지 끝냈어요. 3개는 사람이 손대야 했어요.",
    );
    expect(first).toContain("Human Check 뒤 병합 1/2개 · 50%");

    const second = panelText(render(page, { selectedKey: "runner-b" }));
    expect(second).toContain("Failed 3개 · 75%");
    expect(second).toContain("Human Check 뒤 병합 0/1개 · 0%");
    expect(second).toContain("완료 보고(실패) · PR 없음 2개");
  });

  it("기간에 끝난 런이 없으면 빈 목록 문구를 보이고 패널을 비운다", () => {
    const page = loadStatsPage(seedStatsDatabase(), undefined, new Date("2027-01-01T00:00:00Z"));
    const html = render(page);
    expect(text(html)).toContain("최근 14일 동안 끝난 런이 없어요.");
    expect(text(html)).toContain("이 기간에 Failed 런이 없어요.");
    expect(panelText(html).trim()).toBe("");
  });

  it("전체 보기에서는 Workspace 를 고르라고 안내한다", () => {
    const html = text(render(loadStatsPage(seedStatsDatabase(), "all", now)));
    expect(html).toContain("통계는 Workspace마다 봐요.");
    expect(html).toContain("Acme Labs 보기");
  });

  describe("취소(Q82.9·Q82.18)", () => {
    const page = () => {
      const db = seedStatsDatabase();
      addRunDecisionCases(db);
      return loadStatsPage(db, undefined, now);
    };

    it("기간 요약은 취소를 따로 보이고 Merged 비율에서 뺀다", () => {
      const html = render(page());
      expect(text(html)).toContain("13 끝난 런 취소 2개는 비율에서 빼요");
      // Merged 2 / (13 - 취소 2)
      expect(text(html)).toContain("18% Merged");
      expect(html).toContain(
        "<title>11월 17일: Merged 1 · Human Check 0 · Failed 2 · 취소 2</title>",
      );
    });

    it("나눠 보기 행과 패널의 비율은 취소를 뺀 런으로 나눈다", () => {
      const p = page();
      const rows = rowTexts(render(p, { dimension: "agent" }));
      expect(rows.find((r) => r[0] === "gemini")).toEqual([
        "gemini",
        "2",
        "0%",
        "0",
        "1",
        "1",
        "11분",
      ]);
      const panel = panelText(render(p, { dimension: "agent", selectedKey: "gemini" }));
      expect(panel).toContain(
        "취소를 뺀 런 1개 중 0개를 에이전트가 병합까지 끝냈어요. 1개는 사람이 손대야 했어요. 취소한 1개는 비율에서 뺐어요.",
      );
      expect(panel).toContain("Failed 1개 · 100%");
      expect(panel).toContain("취소 1개 · 비율에서 빼요");
      expect(panel).toContain("비정상 종료 · PR 없음 1개");
    });

    it("시작하지 않고 끝난 런의 실행 시간은 0으로 보인다(Q82.20)", () => {
      const panel = panelText(render(page(), { dimension: "agent", selectedKey: "aider" }));
      expect(panel).toContain("실행 시간 중앙값 0초");
      expect(panel).toContain("대기 시간 중앙값 5분");
      expect(panel).toContain("시작할 수 없음 · PR 없음 1개");
    });
  });
});
