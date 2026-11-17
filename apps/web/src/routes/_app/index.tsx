import { createFileRoute } from "@tanstack/react-router";
import { createTranslator } from "use-intl";
import { z } from "zod";
import { HomeScreen } from "../../home/home-screen";
import { homeMessages } from "../../home/messages";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { getHomePage } from "../../server/functions";

const t = createTranslator({ locale: defaultLocale, messages: homeMessages, namespace: "home" });

/** 홈: 현재 Workspace 의 손댈 일, 실행 중, Queued. 고른 행(sel)은 주소에 남는다 */
export const Route = createFileRoute("/_app/")({
  validateSearch: z.object({ sel: z.string().optional() }),
  loaderDeps: ({ search }) => ({ ws: search.ws }),
  loader: ({ deps }) => getHomePage({ data: { ws: deps.ws } }),
  head: () => ({ meta: [{ title: t("documentTitle") }] }),
  component: HomeRoute,
});

function HomeRoute() {
  const page = Route.useLoaderData();
  const { sel } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ScreenMessages messages={homeMessages}>
      <HomeScreen
        page={page}
        selectedKey={sel}
        onSelect={(key) => {
          void navigate({ search: (prev) => ({ ...prev, sel: key }), replace: true });
        }}
        onAnswer={() => Promise.reject(new Error("not wired"))}
        onDeny={() => Promise.reject(new Error("not wired"))}
      />
    </ScreenMessages>
  );
}
