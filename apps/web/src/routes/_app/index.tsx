import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { createTranslator } from "use-intl";
import { HomeScreen } from "../../home/home-screen";
import { homeMessages } from "../../home/messages";
import type { HomePage } from "../../home/model";
import { useRefreshWhileVisible } from "../../home/refresh";
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
  const loaded = Route.useLoaderData();
  const { ws } = Route.useLoaderDeps();
  const router = useRouter();
  // 새 손댈 일·사건·"N분 전"을 새로 고치지 않아도 보인다(티켓 0050). 주기적으로 다시 읽은 화면은
  // 그것을 읽기 시작할 때의 로더 데이터(base) 위에서만 쓴다. 로더가 다시 돌면(답·거절, Workspace 바꾸기)
  // 그 결과가 이긴다.
  const [polled, setPolled] = useState<{ base: HomePage; page: HomePage } | null>(null);
  const page = polled !== null && polled.base === loaded ? polled.page : loaded;
  useRefreshWhileVisible(() => {
    // router.invalidate 로 다시 읽으면 한 번의 실패(잠깐 끊긴 네트워크, 깨어난 직후)가 라우트를 에러 화면으로
    // 바꿔 열린 폼과 쓰던 답이 사라진다. 그래서 직접 읽고, 실패하면 지금 화면을 두고 다음 주기에 다시 읽는다.
    void getHomePage({ data: { ws } }).then(
      (next) => setPolled({ base: loaded, page: next }),
      () => {},
    );
  });
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
