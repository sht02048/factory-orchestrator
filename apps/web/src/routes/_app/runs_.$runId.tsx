import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { createTranslator } from "use-intl";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { runMessages } from "../../run-detail/messages";
import { RunDetailScreen } from "../../run-detail/run-detail-screen";
import type { RunActionResult } from "../../run-detail/actions";
import { answerRunQuestion, cancelRun, getRunDetail, requestRunLog } from "../../server/functions";

const t = createTranslator({ locale: defaultLocale, messages: runMessages, namespace: "run" });

// 작업 중: 권한 대기·거절 표는 0020 이 packages/db 에 더한다. 그 뒤 server function 으로 바꾼다.
const denyNotStored = (): Promise<RunActionResult> =>
  Promise.resolve({ ok: false, reason: "not-available" });

/** 행동이 거절되면 화면이 실패를 보이도록 던진다 */
function expectOk(result: RunActionResult): void {
  if (!result.ok) throw new Error(result.reason);
}

/** worker 가 로그 꼬리를 쓰기를 기다리며 다시 읽는 간격 */
const LOG_POLL_MS = 2_000;

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
    void requestRunLog({ data: { runId } }).then((requested) =>
      requested ? router.invalidate() : undefined,
    );
  }, [runId, router]);

  // worker 가 결과를 쓸 때까지 다시 읽는다.
  useEffect(() => {
    if (!pendingLog) return undefined;
    const timer = setInterval(() => void router.invalidate(), LOG_POLL_MS);
    return () => clearInterval(timer);
  }, [pendingLog, router]);

  const search = ws === undefined ? "" : `?ws=${encodeURIComponent(ws)}`;
  return (
    <ScreenMessages messages={runMessages}>
      <RunDetailScreen
        page={page}
        runsHref={`/runs${search}`}
        runHref={(id) => `/runs/${encodeURIComponent(id)}${search}`}
        onAnswer={async (questionId, answer) => {
          expectOk(await answerRunQuestion({ data: { runId, questionId, answer } }));
          await reload();
        }}
        onDeny={async () => {
          expectOk(await denyNotStored());
          await reload();
        }}
        onCancel={async () => {
          expectOk(await cancelRun({ data: { runId } }));
          await reload();
        }}
        onRefreshLog={() => {
          void requestRunLog({ data: { runId } }).then(reload);
        }}
      />
    </ScreenMessages>
  );
}
