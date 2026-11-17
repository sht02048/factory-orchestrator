import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { createTranslator } from "use-intl";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { runMessages } from "../../run-detail/messages";
import { RunDetailScreen } from "../../run-detail/run-detail-screen";
import type { RunActionResult } from "../../run-detail/actions";
import {
  answerQuestion,
  cancelRun,
  denyPermission,
  getRunDetail,
  requestRunLog,
} from "../../server/functions";

const t = createTranslator({ locale: defaultLocale, messages: runMessages, namespace: "run" });

/** 행동이 거절되면 화면이 실패를 보이도록 던진다 */
function expectOk(result: RunActionResult): void {
  if (!result.ok) throw new Error(result.reason);
}

/** worker 가 로그 꼬리를 쓰기를 기다리며 다시 읽는 간격과 횟수. 넘으면 멈추고 다시 가져오기를 맡긴다 */
const LOG_POLL_MS = 2_000;
const LOG_POLL_LIMIT = 15;

/** Run 상세: 런 하나의 결과와 이유, 타임라인, PR·CI, 로그 꼬리(0022). Runs 목록과 따로 둔다 */
export const Route = createFileRoute("/_app/runs_/$runId")({
  loader: ({ params }) => getRunDetail({ data: { runId: params.runId } }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title:
          loaderData?.kind === "found"
            ? t("documentTitle", { ticket: loaderData.run.ticketKey })
            : t("documentTitleNotFound"),
      },
    ],
  }),
  component: RunDetailRoute,
});

function RunDetailRoute() {
  const page = Route.useLoaderData();
  const { runId } = Route.useParams();
  const { ws } = Route.useSearch();
  const router = useRouter();
  const reload = () => router.invalidate();
  const pendingLog = page.kind === "found" && page.run.log.kind === "pending";

  // 화면을 열면 로그 꼬리를 요청한다. web 은 ssh 를 쓰지 않는다(Q61).
  useEffect(() => {
    requestRunLog({ data: { runId } })
      .then((requested) => (requested ? router.invalidate() : undefined))
      // 요청을 남기지 못해도 화면은 DB 에 있는 값을 그대로 보인다.
      .catch(() => undefined);
  }, [runId, router]);

  // worker 가 결과를 쓸 때까지 다시 읽는다. worker 가 멈춰 있어도 끝없이 읽지 않게 횟수를 둔다.
  const [polls, setPolls] = useState(0);
  useEffect(() => {
    if (!pendingLog || polls >= LOG_POLL_LIMIT) return undefined;
    const timer = setTimeout(() => {
      setPolls((n) => n + 1);
      void router.invalidate();
    }, LOG_POLL_MS);
    return () => clearTimeout(timer);
  }, [pendingLog, polls, router]);

  const search = ws === undefined ? "" : `?ws=${encodeURIComponent(ws)}`;
  return (
    <ScreenMessages messages={runMessages}>
      <RunDetailScreen
        page={page}
        runsHref={`/runs${search}`}
        runHref={(id) => `/runs/${encodeURIComponent(id)}${search}`}
        onAnswer={async (questionId, answer) => {
          await answerQuestion({ data: { runId, questionId, answer } });
          await reload();
        }}
        onDeny={async (promptId, reason) => {
          await denyPermission({ data: { runId, promptId, reason } });
          await reload();
        }}
        onCancel={async () => {
          expectOk(await cancelRun({ data: { runId } }));
          await reload();
        }}
        onRefreshLog={() => {
          setPolls(0);
          requestRunLog({ data: { runId } })
            .then(reload)
            .catch(() => undefined);
        }}
      />
    </ScreenMessages>
  );
}
