import { createFileRoute } from "@tanstack/react-router";
import { createTranslator } from "use-intl";
import { z } from "zod";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { runnersMessages } from "../../runners/messages";
import { RunnersScreen } from "../../runners/runners-screen";
import { getRunnersPage } from "../../server/functions";

const t = createTranslator({
  locale: defaultLocale,
  messages: runnersMessages,
  namespace: "runners",
});

/**
 * Runners: 모든 러너. 러너는 Workspace 밖 자원이라 loader 가 ws 에 기대지 않는다(ADR 0006).
 * 고른 러너(sel)는 주소에 남는다.
 */
export const Route = createFileRoute("/_app/runners")({
  validateSearch: z.object({ sel: z.string().optional() }),
  loader: () => getRunnersPage(),
  // 행을 고르거나 Workspace 를 바꿔도 다시 읽지 않는다. 같은 러너 목록이다.
  shouldReload: false,
  head: () => ({ meta: [{ title: t("documentTitle") }] }),
  component: RunnersRoute,
});

function RunnersRoute() {
  const page = Route.useLoaderData();
  const { sel } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ScreenMessages messages={runnersMessages}>
      <RunnersScreen
        page={page}
        selectedId={sel}
        onSelect={(id) => {
          void navigate({ search: (prev) => ({ ...prev, sel: id }), replace: true });
        }}
      />
    </ScreenMessages>
  );
}
