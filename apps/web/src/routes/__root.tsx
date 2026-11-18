import * as stylex from "@stylexjs/stylex";
import { Toaster } from "@factory/ui";
import { colors, fonts, fontSize, lineHeight } from "@factory/ui/tokens.stylex";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  redirect,
  rootRouteId,
  useRouter,
} from "@tanstack/react-router";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { IntlProvider, useTranslations } from "use-intl";
import { appMessages, defaultLocale, t } from "../i18n";
import { ONBOARDING_PATH, isOpenPath, onboardingRedirect } from "../onboarding/model";
import { getTimeZone } from "../server/functions";
import { getOnboardingComplete } from "../server/onboarding-functions";
import { localTimeZone, timeZoneCookie, timeZoneFromCookies } from "../time-zone";
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
  /**
   * 화면 시각을 그리는 시간대(0044). 서버가 요청의 쿠키로 읽어 서버 렌더링과 hydration 이 같은 값을 쓴다.
   * 브라우저 시간대가 바뀌면 TimeZoneSync 가 다시 읽게 한다.
   */
  loader: () => getTimeZone(),
  shouldReload: false,
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
  const timeZone = Route.useLoaderData();
  return (
    <IntlProvider locale={defaultLocale} messages={appMessages} timeZone={timeZone}>
      <TimeZoneSync timeZone={timeZone} />
      <Outlet />
      <AppToaster />
    </IntlProvider>
  );
}

/**
 * 브라우저 시간대가 서버가 그린 시간대와 다르면(첫 방문, 지난 방문 뒤 시간대를 옮김) 쿠키에 남기고,
 * 시간대를 쓰는 데이터(루트의 시간대, Stats 날짜 구간, Home 의 오늘 Merged)를 다시 읽는다. 열린 탭에서 OS 시간대를 바꾸면
 * 다음에 페이지를 열 때 맞춘다. hydration 이 끝난 뒤에 돌아 서버 렌더링과 어긋나지 않는다.
 * 쿠키에 이미 같은 값이 있으면(쿠키를 막았거나 서버가 다른 이름을 쓰는 경우) 다시 읽지 않는다.
 */
function TimeZoneSync({ timeZone }: { timeZone: string }) {
  const router = useRouter();
  useEffect(() => {
    const local = localTimeZone();
    if (local === timeZone || timeZoneFromCookies(document.cookie) === local) return;
    document.cookie = timeZoneCookie(local);
    void router.invalidate({
      filter: (match) =>
        match.routeId === rootRouteId ||
        match.routeId === "/_app/stats" ||
        match.routeId === "/_app/",
    });
  }, [router, timeZone]);
  return null;
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
