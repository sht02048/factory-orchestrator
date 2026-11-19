import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { createTranslator } from "use-intl";
import { toRunId } from "@ganger/core";
import { z } from "zod";
import { HomeScreen } from "../../home/home-screen";
import { homeMessages } from "../../home/messages";
import type { HomePage } from "@ganger/app/home/model";
import { useRefreshWhileVisible } from "../../home/refresh";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { hasPendingControl } from "@ganger/app/home/model";
import { answerQuestion, controlRun, denyPermission, getHomePage } from "../../server/functions";

const CONTROL_POLL_MS = 2_000;

const t = createTranslator({ locale: defaultLocale, messages: homeMessages, namespace: "home" });

export const Route = createFileRoute("/_app/")({
  validateSearch: z.object({
    view: z.enum(["todo"]).optional().catch(undefined),
    run: z.string().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ ws: search.ws }),
  loader: ({ deps }) => getHomePage({ data: { ws: deps.ws } }),
  head: () => ({ meta: [{ title: t("documentTitle") }] }),
  component: HomeRoute,
});

function HomeRoute() {
  const loaded = Route.useLoaderData();
  const { ws } = Route.useLoaderDeps();
  const { view, run } = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const [polled, setPolled] = useState<{ base: HomePage; page: HomePage } | null>(null);
  const page = polled !== null && polled.base === loaded ? polled.page : loaded;
  const clearOpenRun = useCallback(() => {
    void navigate({
      search: (prev) => ({ ...prev, run: undefined }),
      replace: true,
      resetScroll: false,
    });
  }, [navigate]);
  const refresh = useCallback(() => {
    void getHomePage({ data: { ws } }).then(
      (next) => setPolled({ base: loaded, page: next }),
      () => {},
    );
  }, [ws, loaded]);
  useRefreshWhileVisible(refresh);
  const controlPending = hasPendingControl(page);
  useEffect(() => {
    if (!controlPending) return undefined;
    const timer = setTimeout(refresh, CONTROL_POLL_MS);
    return () => clearTimeout(timer);
  }, [controlPending, page, refresh]);
  return (
    <ScreenMessages messages={homeMessages}>
      <HomeScreen
        page={page}
        view={view ?? "all"}
        onViewChange={(next) => {
          void navigate({
            search: (prev) => ({ ...prev, view: next === "all" ? undefined : next }),
            replace: true,
            resetScroll: false,
          });
        }}
        onAnswer={async (input) => {
          await answerQuestion({ data: input });
          await router.invalidate();
        }}
        onDeny={async (input) => {
          await denyPermission({ data: input });
          await router.invalidate();
        }}
        onControl={async (input) => {
          const result = await controlRun({ data: input });
          if (!result.ok) throw new Error(result.reason);
          await router.invalidate();
        }}
        openRunId={run === undefined ? undefined : toRunId(run)}
        onOpenRunShown={clearOpenRun}
      />
    </ScreenMessages>
  );
}
