import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { appMessages, defaultLocale } from "../i18n";
import type { AppMessages } from "../i18n";
import { DEFAULT_TIME_ZONE } from "../time-zone";

/**
 * 공용 메시지와 화면 메시지를 싣고 서버 렌더한다. 메시지 키가 없거나 인자가 틀리면 던진다.
 * 시간대를 주지 않으면 UTC 로 그린다.
 */
export function renderWithMessages(
  node: ReactNode,
  screen: Partial<AppMessages> = {},
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  return renderToString(
    <IntlProvider
      locale={defaultLocale}
      messages={{ ...appMessages, ...screen }}
      timeZone={timeZone}
      onError={(error) => {
        throw error;
      }}
    >
      {node}
    </IntlProvider>,
  );
}
