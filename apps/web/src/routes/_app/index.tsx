import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { createTranslator } from "use-intl";
import { z } from "zod";
import { HomeScreen } from "../../home/home-screen";
import { homeMessages } from "../../home/messages";
import type { HomePage } from "@ganger/app/home/model";
import { useRefreshWhileVisible } from "../../home/refresh";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { answerQuestion, denyPermission, getHomePage } from "../../server/functions";

const t = createTranslator({ locale: defaultLocale, messages: homeMessages, namespace: "home" });

export const Route = createFileRoute("/_app/")({
  validateSearch: z.object({
    view: z.enum(["todo"]).optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ ws: search.ws }),
  loader: ({ deps }) => getHomePage({ data: { ws: deps.ws } }),
  head: () => ({ meta: [{ title: t("documentTitle") }] }),
  component: HomeRoute,
});

function HomeRoute() {
  const loaded = Route.useLoaderData();
  const { ws } = Route.useLoaderDeps();
  const { view } = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const [polled, setPolled] = useState<{ base: HomePage; page: HomePage } | null>(null);
  const page = polled !== null && polled.base === loaded ? polled.page : loaded;
  useRefreshWhileVisible(() => {
    void getHomePage({ data: { ws } }).then(
      (next) => setPolled({ base: loaded, page: next }),
      () => {},
    );
  });
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
      />
    </ScreenMessages>
  );
}
