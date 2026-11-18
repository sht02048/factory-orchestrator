import type { ReactNode } from "react";
import { IntlProvider, createTranslator, useMessages, useTimeZone } from "use-intl";
import domain from "../messages/ko/domain.json" with { type: "json" };
import shell from "../messages/ko/shell.json" with { type: "json" };
import { DEFAULT_TIME_ZONE } from "./time-zone";

export interface AppMessages {
  shell: typeof shell;
  domain: typeof domain;
}

export const defaultLocale = "ko";

export const appMessages = { shell, domain };

declare module "use-intl" {
  interface AppConfig {
    Locale: "ko";
    Messages: AppMessages;
  }
}

export const t = createTranslator({ locale: defaultLocale, messages: appMessages });

export function ScreenMessages({
  messages,
  children,
}: {
  messages: Partial<AppMessages>;
  children: ReactNode;
}) {
  const parent = useMessages();
  const timeZone = useTimeZone() ?? DEFAULT_TIME_ZONE;
  return (
    <IntlProvider locale={defaultLocale} timeZone={timeZone} messages={{ ...parent, ...messages }}>
      {children}
    </IntlProvider>
  );
}
