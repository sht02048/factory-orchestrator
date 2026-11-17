import { renderToString } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it } from "vitest";

import { defaultLocale, messages, timeZone } from "../i18n";
import { DesignSystemPage } from "./page";

function renderPage(): string {
  return renderToString(
    <IntlProvider
      locale={defaultLocale}
      messages={messages}
      timeZone={timeZone}
      onError={(error) => {
        // 메시지 키가 없거나 인자가 틀리면 테스트를 깨뜨린다.
        throw error;
      }}
    >
      <DesignSystemPage />
    </IntlProvider>,
  );
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
    ];
    expect(ids.filter((id) => !html.includes(`id="${id}"`))).toEqual([]);
    expect(ids.filter((id) => !html.includes(`href="#${id}"`))).toEqual([]);
  });

  it("문구는 메시지 파일에서 온다", () => {
    const html = renderPage();
    expect(html).toContain(messages.ds.title);
    expect(html).toContain(messages.ds.buttons.primary);
    expect(html).toContain(messages.ds.table.rows.r1051.title);
    // 메시지 키가 그대로 새어 나오지 않는다.
    expect(html).not.toMatch(/ds\.(nav|buttons|table)\./);
  });
});
