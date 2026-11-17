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

/** 화면에 들어올 때만 loader 를 다시 돌린다 */
export function reloadOnEnter({ cause }: { cause: "preload" | "enter" | "stay" }): boolean {
  return cause === "enter";
}

/**
 * Runners: 모든 러너. 러너는 Workspace 밖 자원이라 loader 가 ws 에 기대지 않는다(ADR 0006).
 * 고른 러너(sel)는 주소에 남는다.
 */
export const Route = createFileRoute("/_app/runners")({
  validateSearch: z.object({ sel: z.string().optional() }),
  loader: () => getRunnersPage(),
  // 화면에 들어올 때마다 새로 읽는다. 행을 고르거나 Workspace 를 바꿀 때(stay)는 같은 러너 목록이라 다시 읽지 않는다.
  shouldReload: reloadOnEnter,
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
