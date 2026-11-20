import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { SHELL_KEY } from "../shell/shell-query";
import { TRACKER_KEY } from "../tickets/tickets-query";
import { rereadTrackers } from "../server/functions";
import { webhookReceiptKey } from "@ganger/app/settings/model";
import {
  addWorkspaceTrackerProject,
  checkGitHubTokenNow,
  checkWebhookAddressNow,
  getTrackerWebhookState,
  checkTrackerConnectionNow,
  createWorkspaceAutoAssignLabel,
  getRunnerChecksPending,
  removeWorkspaceTrackerProject,
  requestRunnerCheckNow,
  saveAddressesSetting,
  saveGitHubTokenSetting,
  saveMcpWriteSettings,
  savePowerSettings,
  saveRunnerSettings,
  saveTrackerConnection,
  saveWorkspaceGeneral,
  saveWorkspaceInProgressState,
  saveWorkspaceLabel,
  saveWorkspaceMapping,
  turnOffTrackerWebhook,
} from "../server/settings-functions";
import type { ActionResult, SettingsActions } from "./settings-screen";

export type ReloadOnSuccess = <I>(
  call: (input: I) => Promise<ActionResult>,
) => (input: I) => Promise<ActionResult>;

export type AfterSave = () => Promise<unknown>;

export function useSettingsReload(): AfterSave {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: SHELL_KEY });
    await router.invalidate({ sync: true });
  }, [router, queryClient]);
}

export function useReloadOnSuccess(afterSave: AfterSave): ReloadOnSuccess {
  return useMemo(
    (): ReloadOnSuccess => (call) => async (input) => {
      const result = await call(input);
      if (result.ok) await afterSave();
      return result;
    },
    [afterSave],
  );
}

export function useSettingsActions(afterSave: AfterSave): SettingsActions {
  const router = useRouter();
  const queryClient = useQueryClient();
  const then = useReloadOnSuccess(afterSave);
  const afterTrackerSave = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: TRACKER_KEY });
    await afterSave();
  }, [queryClient, afterSave]);
  const thenTracker = useReloadOnSuccess(afterTrackerSave);
  return useMemo(
    (): SettingsActions => ({
      saveGeneral: then((data) => saveWorkspaceGeneral({ data })),
      addProject: thenTracker((data) => addWorkspaceTrackerProject({ data })),
      removeProject: thenTracker((data) => removeWorkspaceTrackerProject({ data })),
      saveMapping: then((data) => saveWorkspaceMapping({ data })),
      saveInProgress: then((data) => saveWorkspaceInProgressState({ data })),
      saveLabel: then((data) => saveWorkspaceLabel({ data })),
      createLabel: async (data) => {
        const result = await createWorkspaceAutoAssignLabel({ data });
        if (result.ok)
          await Promise.all([
            router.invalidate({ sync: true }),
            queryClient.invalidateQueries({ queryKey: TRACKER_KEY }),
          ]);
        return result;
      },
      reloadFromTracker: async () => {
        await rereadTrackers();
        await Promise.all([
          router.invalidate({ sync: true }),
          queryClient.invalidateQueries({ queryKey: TRACKER_KEY }),
        ]);
      },
      saveConnection: thenTracker((data) => saveTrackerConnection({ data })),
      checkConnection: (data) => checkTrackerConnectionNow({ data }),
      saveGitHubToken: then((data) => saveGitHubTokenSetting({ data })),
      checkGitHubToken: () => checkGitHubTokenNow(),
      saveRunner: then((data) => saveRunnerSettings({ data })),
      recheckRunner: then((data) => requestRunnerCheckNow({ data })),
      saveAddresses: then((data) => saveAddressesSetting({ data })),
      savePower: then((data) => savePowerSettings({ data })),
      saveMcpWrite: then((data) => saveMcpWriteSettings({ data })),
      pollRunnerChecks: async () => {
        const pending = await getRunnerChecksPending();
        if (!pending) await router.invalidate();
        return pending;
      },
      checkWebhookAddress: then((data) => checkWebhookAddressNow({ data })),
      turnOffWebhook: then((data) => turnOffTrackerWebhook({ data })),
      pollWebhookState: async ({ id, key }) => {
        const state = await getTrackerWebhookState({ data: { id } });
        if (state !== null && webhookReceiptKey(state) === key) return true;
        await router.invalidate();
        return false;
      },
    }),
    [router, queryClient, then, thenTracker],
  );
}
