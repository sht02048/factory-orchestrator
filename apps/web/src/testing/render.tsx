import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { appMessages, defaultLocale } from "../i18n";
import type { AppMessages } from "../i18n";
import { DEFAULT_TIME_ZONE } from "@ganger/app/time-zone";

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
