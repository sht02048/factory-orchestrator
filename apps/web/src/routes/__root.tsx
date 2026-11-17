import * as stylex from "@stylexjs/stylex";
import { Toaster } from "@factory/ui";
import { colors, fonts, fontSize, lineHeight } from "@factory/ui/tokens.stylex";
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { IntlProvider, useTranslations } from "use-intl";
import { defaultLocale, messages, t, timeZone } from "../i18n";
import appCss from "../styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: t("app.title") },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      // 아직 아이콘이 없다. 브라우저가 /favicon.ico 를 요청해 404 를 남기지 않게 비워 둔다.
      { rel: "icon", href: "data:," },
    ],
  }),
  shellComponent: RootDocument,
  component: RootLayout,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang={defaultLocale}>
      <head>
        <HeadContent />
        {import.meta.env.DEV ? <link rel="stylesheet" href="/virtual:stylex.css" /> : null}
      </head>
      <body {...stylex.props(styles.body)}>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootLayout() {
  return (
    <IntlProvider locale={defaultLocale} messages={messages} timeZone={timeZone}>
      <Outlet />
      <AppToaster />
    </IntlProvider>
  );
}

function AppToaster() {
  const tApp = useTranslations("app");
  return <Toaster label={tApp("toastRegion")} />;
}

const styles = stylex.create({
  body: {
    margin: 0,
    backgroundColor: colors.bgCanvas,
    color: colors.textPrimary,
    fontFamily: fonts.sans,
    fontSize: fontSize.ui,
    lineHeight: lineHeight.normal,
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
    fontSynthesis: "none",
    wordBreak: "keep-all",
    overflowWrap: "break-word",
  },
});
