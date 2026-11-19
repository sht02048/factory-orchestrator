import * as stylex from "@stylexjs/stylex";
import { Toaster, WindowChrome, documentStyles } from "@ganger/ui";
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
import { NotFoundScreen } from "../not-found/not-found-screen";
import { ONBOARDING_PATH, isOpenPath, onboardingRedirect } from "../onboarding/model";
import { getTimeZone, getTitleBarHidden } from "../server/functions";
import { getOnboardingComplete } from "../server/onboarding-functions";
import { localTimeZone, timeZoneCookie, timeZoneFromCookies } from "@ganger/app/time-zone";
import appCss from "../styles/app.css?url";

let completeInBrowser = false;

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    if (completeInBrowser || isOpenPath(location.pathname)) return;
    const complete = await getOnboardingComplete();
    if (complete && typeof window !== "undefined") completeInBrowser = true;
    if (onboardingRedirect(location.pathname, complete) !== null)
      throw redirect({ to: ONBOARDING_PATH });
  },
  loader: async () => {
    const [timeZone, titleBarHidden] = await Promise.all([getTimeZone(), getTitleBarHidden()]);
    return { timeZone, titleBarHidden };
  },
  shouldReload: false,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: t("shell.documentTitle") },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
      { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootDocument,
  component: RootLayout,
  notFoundComponent: NotFoundScreen,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang={defaultLocale}>
      <head>
        <HeadContent />
        {import.meta.env.DEV ? <link rel="stylesheet" href="/virtual:stylex.css" /> : null}
      </head>
      <body {...stylex.props(documentStyles.body)}>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootLayout() {
  const { timeZone, titleBarHidden } = Route.useLoaderData();
  return (
    <IntlProvider locale={defaultLocale} messages={appMessages} timeZone={timeZone}>
      <WindowChrome titleBarHidden={titleBarHidden}>
        <TimeZoneSync timeZone={timeZone} />
        <Outlet />
        <AppToaster />
      </WindowChrome>
    </IntlProvider>
  );
}

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
