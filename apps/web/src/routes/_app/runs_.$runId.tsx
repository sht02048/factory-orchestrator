import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { createTranslator } from "use-intl";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { runMessages } from "../../run-detail/messages";
import { RunDetailScreen } from "../../run-detail/run-detail-screen";
import type { RunActionResult } from "@ganger/app/run-detail/actions";
import {
  answerQuestion,
  cancelRun,
  denyPermission,
  getRunDetail,
  requestRunLog,
} from "../../server/functions";

const t = createTranslator({ locale: defaultLocale, messages: runMessages, namespace: "run" });

function expectOk(result: RunActionResult): void {
  if (!result.ok) throw new Error(result.reason);
}

const LOG_POLL_MS = 2_000;
const LOG_POLL_LIMIT = 15;

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

  useEffect(() => {
    requestRunLog({ data: { runId } })
      .then((requested) => (requested ? router.invalidate() : undefined))
      .catch(() => undefined);
  }, [runId, router]);

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
        onRefreshLog={async () => {
          setPolls(0);
          await requestRunLog({ data: { runId } });
          await reload();
        }}
      />
    </ScreenMessages>
  );
}
