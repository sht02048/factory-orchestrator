import { describe, expect, it } from "vitest";

import { renderWithMessages } from "../testing/render";
import { dsMessages } from "./messages";
import { DesignSystemPage } from "./page";

const messages = dsMessages;

function renderPage(): string {
  return renderWithMessages(<DesignSystemPage />, dsMessages);
}

describe("/ds 서버 렌더", () => {
  it("오류 없이 모든 토큰·컴포넌트 구역을 그린다", () => {
    const html = renderPage();
    const ids = [
      "colors",
      "typography",
      "space",
      "size",
      "radius",
      "shadow",
      "motion",
      "buttons",
      "status",
      "tabs",
      "table",
      "definitions",
      "menu",
      "form",
      "tooltip",
      "dialog",
      "toast",
      "surfaces",
      "statusDot",
      "sections",
      "segmented",
      "groupHeader",
      "capacity",
      "problem",
      "statTile",
      "brand",
    ];
    expect(ids.filter((id) => !html.includes(`id="${id}"`))).toEqual([]);
    expect(ids.filter((id) => !html.includes(`href="#${id}"`))).toEqual([]);
  });

  it("문구는 메시지 파일에서 온다", () => {
    const html = renderPage();
    expect(html).toContain(messages.ds.title);
    expect(html).toContain(messages.ds.buttons.primary);
    expect(html).toContain(messages.ds.table.rows.r1051.title);
    expect(html).not.toMatch(/ds\.(nav|buttons|table)\./);
  });

  it("새 글자 역할과 컴포넌트 미리보기를 그린다(티켓 0073)", () => {
    const html = renderPage();
    expect(html).toContain(messages.ds.typography.sampleDisplay);
    expect(html).toContain(messages.ds.typography.sampleSubheading);
    expect(html).toContain(`aria-label="${messages.ds.segmented.periodLabel}"`);
    expect(html).toContain('role="meter"');
    expect(html).toContain(messages.ds.problem.title);
    expect(html).toContain(messages.ds.groupHeader.stuckTitle);
    expect(html).toContain(messages.ds.statTile.doneDetail);
  });
});
