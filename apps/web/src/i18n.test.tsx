import { describe, expect, it } from "vitest";
import { useTranslations } from "use-intl";
import { ScreenMessages, appMessages } from "./i18n";
import { placeholderMessages } from "./placeholder/messages";
import { PlaceholderScreen } from "./placeholder/placeholder-screen";
import { renderWithMessages } from "./testing/render";

describe("화면별 메시지 파일(ADR 0005)", () => {
  it("루트에는 공용 파일(shell, domain)만 싣는다", () => {
    expect(Object.keys(appMessages).sort()).toEqual(["domain", "shell"]);
  });

  it("화면 파일은 그 화면 모듈이 ScreenMessages 로 싣는다: i18n.tsx 를 고치지 않고 더한 예", () => {
    const html = renderWithMessages(<PlaceholderScreen screen="stats" />);
    expect(html).toContain(placeholderMessages.placeholder.body);
    expect(html).toContain(appMessages.shell.nav.stats);
  });

  it("ScreenMessages 는 바깥 메시지를 지우지 않고 더한다", () => {
    function Probe() {
      const shell = useTranslations("shell");
      const placeholder = useTranslations("placeholder");
      return (
        <p>
          {shell("brand")}|{placeholder("body")}
        </p>
      );
    }
    const html = renderWithMessages(
      <ScreenMessages messages={placeholderMessages}>
        <Probe />
      </ScreenMessages>,
    );
    expect(html.replaceAll("<!-- -->", "")).toContain(
      `${appMessages.shell.brand}|${placeholderMessages.placeholder.body}`,
    );
  });
});
