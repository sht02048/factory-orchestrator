import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { SHELL_KEY } from "../shell/shell-query";
import { TRACKER_KEY } from "../tickets/tickets-query";
import { rereadTrackers } from "../server/functions";
import {
  addWorkspaceTrackerProject,
  checkGitHubTokenNow,
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
} from "../server/settings-functions";
import type { ActionResult, SettingsActions } from "./settings-screen";

export type ReloadOnSuccess = <I>(
  call: (input: I) => Promise<ActionResult>,
) => (input: I) => Promise<ActionResult>;

export type AfterSave = () => Promise<unknown>;

export function useRouterReload(): AfterSave {
  const router = useRouter();
  return useCallback(() => router.invalidate(), [router]);
}

export function useSettingsReload(): AfterSave {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: SHELL_KEY });
    await router.invalidate();
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
  return useMemo(
    (): SettingsActions => ({
      saveGeneral: then((data) => saveWorkspaceGeneral({ data })),
      addProject: then((data) => addWorkspaceTrackerProject({ data })),
      removeProject: then((data) => removeWorkspaceTrackerProject({ data })),
      saveMapping: then((data) => saveWorkspaceMapping({ data })),
      saveInProgress: then((data) => saveWorkspaceInProgressState({ data })),
      saveLabel: then((data) => saveWorkspaceLabel({ data })),
      createLabel: async (data) => {
        const result = await createWorkspaceAutoAssignLabel({ data });
        if (result.ok)
          await Promise.all([
            router.invalidate(),
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
      saveConnection: then((data) => saveTrackerConnection({ data })),
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
    }),
    [router, queryClient, then],
  );
}
