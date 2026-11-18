import { createFileRoute, useRouter } from "@tanstack/react-router";
import { createTranslator } from "use-intl";
import { HomeScreen } from "../../home/home-screen";
import { homeMessages } from "../../home/messages";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { answerQuestion, denyPermission, getHomePage } from "../../server/functions";

const t = createTranslator({ locale: defaultLocale, messages: homeMessages, namespace: "home" });

/** Home: 현재 Workspace 의 손댈 일 카드와 지금 일어나는 일 */
export const Route = createFileRoute("/_app/")({
  loaderDeps: ({ search }) => ({ ws: search.ws }),
  loader: ({ deps }) => getHomePage({ data: { ws: deps.ws } }),
  head: () => ({ meta: [{ title: t("documentTitle") }] }),
  component: HomeRoute,
});

function HomeRoute() {
  const page = Route.useLoaderData();
  const router = useRouter();
  return (
    <ScreenMessages messages={homeMessages}>
      <HomeScreen
        page={page}
        onAnswer={async (input) => {
          await answerQuestion({ data: input });
          // 답했음(answered)을 다시 읽어 답하기 칸을 닫는다
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
