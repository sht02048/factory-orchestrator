import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { createTranslator } from "use-intl";
import { z } from "zod";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { runnersMessages } from "../../runners/messages";
import { RunnerSetup } from "../../runner-setup/runner-setup";
import type { DirectEntry } from "../../runner-setup/runner-setup";
import { runnerSetupMessages } from "../../runner-setup/messages";
import { useRunnerSetupActions } from "../../runner-setup/use-runner-setup-actions";
import { RunnersScreen } from "../../runners/runners-screen";
import { settingsMessages } from "../../settings/messages";
import { NavigationGuard } from "../../settings/navigation-guard";
import { RunnerForm } from "../../settings/settings-screen";
import type { SettingsActions } from "../../settings/settings-screen";
import { useSettingsActions } from "../../settings/use-settings-actions";
import type { ActionResult } from "../../settings/settings-screen";
import type { RunnerActions } from "../../runners/runners-screen";
import {
  RUNNERS_LIST_KEY,
  refreshRunnersAndShell,
  runnerChecksStillPending,
  runnersQuery,
} from "../../runners/runners-query";
import { okOrThrow, rejectionReasonOf, toMutationError } from "../../query/mutation-error";
import { loadRouteQuery } from "../../query/route-query";
import { requestRunnerCheckNow } from "../../server/settings-functions";

const t = createTranslator({
  locale: defaultLocale,
  messages: runnersMessages,
  namespace: "runners",
});

const RECHECK_REJECT_REASONS = ["not-found"] as const;

function recheckResultOf(error: unknown): ActionResult {
  const reason = rejectionReasonOf(error, RECHECK_REJECT_REASONS);
  if (reason === null) throw toMutationError(error, RECHECK_REJECT_REASONS);
  return { ok: false, reason };
}

export const Route = createFileRoute("/_app/runners")({
  validateSearch: z.object({
    sel: z.string().optional(),
    direct: z.boolean().optional().catch(undefined),
  }),
  preloadStaleTime: 0,
  loader: (load) => loadRouteQuery(load, runnersQuery),
  head: () => ({ meta: [{ title: t("documentTitle") }] }),
  component: RunnersRoute,
});

function RunnersRoute() {
  const { data: page } = useSuspenseQuery(runnersQuery);
  const search = Route.useSearch();
  const { sel, ws } = search;
  const navigate = Route.useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const requestCheck = useMutation({
    mutationFn: async (data: { id: string }) =>
      okOrThrow<unknown, (typeof RECHECK_REJECT_REASONS)[number]>(
        await requestRunnerCheckNow({ data }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RUNNERS_LIST_KEY }),
  });
  const { mutateAsync: requestCheckAsync } = requestCheck;
  const actions = useMemo(
    (): RunnerActions => ({
      recheck: (data) =>
        requestCheckAsync(data).then((): ActionResult => ({ ok: true }), recheckResultOf),
      pollChecks: () => runnerChecksStillPending(queryClient),
    }),
    [requestCheckAsync, queryClient],
  );
  const refreshRunners = useCallback(() => refreshRunnersAndShell(queryClient), [queryClient]);
  const settingsActions = useSettingsActions(refreshRunners);
  const setupActions = useRunnerSetupActions(refreshRunners);
  const select = (id: string) => {
    void navigate({ search: (prev) => ({ ...prev, sel: id, direct: undefined }), replace: true });
  };
  const direct = useMemo(
    (): DirectEntry => ({
      open: search.direct === true,
      openHref: router.buildLocation({ to: "/runners", search: { ...search, direct: true } }).href,
      closeHref: router.buildLocation({ to: "/runners", search: { ...search, direct: undefined } })
        .href,
      onChange: (open) => {
        void navigate({ search: (prev) => ({ ...prev, direct: open ? true : undefined }) });
      },
    }),
    [router, navigate, search],
  );
  const knownBeforeAdd = useRef<ReadonlySet<string> | null>(null);
  const addActions = useMemo(
    (): SettingsActions => ({
      ...settingsActions,
      saveRunner: async (input) => {
        knownBeforeAdd.current = new Set(page.runners.map((runner) => runner.id));
        const result = await settingsActions.saveRunner(input);
        if (!result.ok) knownBeforeAdd.current = null;
        return result;
      },
    }),
    [settingsActions, page.runners],
  );
  useEffect(() => {
    const known = knownBeforeAdd.current;
    if (known === null) return;
    const added = page.runners.find((runner) => !known.has(runner.id));
    if (added === undefined) return;
    knownBeforeAdd.current = null;
    void navigate({
      search: (prev) => ({ ...prev, sel: added.id, direct: undefined }),
      replace: true,
    });
  }, [page.runners, navigate]);
  return (
    <ScreenMessages messages={{ ...runnersMessages, ...settingsMessages, ...runnerSetupMessages }}>
      <RunnersScreen
        page={page}
        selectedId={sel}
        ws={ws}
        onSelect={select}
        actions={actions}
        setup={
          <RunnerSetup
            actions={setupActions}
            manualForm={<RunnerForm runner={null} actions={addActions} primary={false} direct />}
            direct={direct}
            onOpenRunner={select}
            primary={false}
          />
        }
        renderGuard={(guard) => <NavigationGuard {...guard} />}
        renderEdit={(runner, controls) => (
          <RunnerForm
            runner={{
              id: runner.id,
              name: runner.name,
              sshTarget: runner.sshTarget ?? "",
              orcaPath: runner.orcaPath ?? "",
              capacity: runner.capacity,
            }}
            actions={settingsActions}
            primary={false}
            onDone={controls.onDone}
            onClose={controls.onClose}
            hints="info"
          />
        )}
      />
    </ScreenMessages>
  );
}
