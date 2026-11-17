import * as stylex from "@stylexjs/stylex";
import { Toaster } from "@factory/ui";
import { colors, fonts, fontSize, lineHeight } from "@factory/ui/tokens.stylex";
import { HeadContent, Outlet, Scripts, createRootRoute, redirect } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { IntlProvider, useTranslations } from "use-intl";
import { appMessages, defaultLocale, t, timeZone } from "../i18n";
import { ONBOARDING_PATH, isOpenPath, onboardingRedirect } from "../onboarding/model";
import { getOnboardingComplete } from "../server/onboarding-functions";
import appCss from "../styles/app.css?url";

/**
 * 브라우저에서 온보딩을 마친 것을 한 번 보면 그 뒤 화면 이동마다 다시 묻지 않는다.
 * 서버(SSR)에서는 요청마다 묻는다. 여러 요청이 한 프로세스를 함께 쓰기 때문이다.
 */
let completeInBrowser = false;

export const Route = createRootRoute({
  /**
   * 온보딩을 마치지 않았으면 어느 화면에 들어가도 온보딩으로 보낸다(0026). 앱 셸 중 0007 밖에서 더한 처리는 이것뿐이다.
   */
  beforeLoad: async ({ location }) => {
    if (completeInBrowser || isOpenPath(location.pathname)) return;
    const complete = await getOnboardingComplete();
    if (complete && typeof window !== "undefined") completeInBrowser = true;
    if (onboardingRedirect(location.pathname, complete) !== null)
      throw redirect({ to: ONBOARDING_PATH });
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: t("shell.documentTitle") },
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
    <IntlProvider locale={defaultLocale} messages={appMessages} timeZone={timeZone}>
      <Outlet />
      <AppToaster />
    </IntlProvider>
  );
}

function AppToaster() {
  const tShell = useTranslations("shell");
  return <Toaster label={tShell("toastRegion")} />;
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
