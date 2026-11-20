import { useRouter } from "@tanstack/react-router";
import { useMemo } from "react";
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

export function useReloadOnSuccess(): ReloadOnSuccess {
  const router = useRouter();
  return useMemo(
    (): ReloadOnSuccess => (call) => async (input) => {
      const result = await call(input);
      if (result.ok) await router.invalidate({ sync: true });
      return result;
    },
    [router],
  );
}

export function useSettingsActions(): SettingsActions {
  const router = useRouter();
  const then = useReloadOnSuccess();
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
        if (result.ok) await router.invalidate({ sync: true });
        return result;
      },
      reloadFromTracker: async () => {
        await rereadTrackers();
        await router.invalidate({ sync: true });
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
    [router, then],
  );
}
