import { useRouter } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  addWorkspaceTrackerProject,
  checkGitHubTokenNow,
  checkTrackerConnectionNow,
  getRunnerChecksPending,
  removeWorkspaceTrackerProject,
  requestRunnerCheckNow,
  saveAddressesSetting,
  saveGitHubTokenSetting,
  saveRunnerSettings,
  saveTrackerConnection,
  saveWorkspaceGeneral,
  saveWorkspaceInProgressState,
  saveWorkspaceLabel,
  saveWorkspaceMapping,
} from "../server/settings-functions";
import type { ActionResult, SettingsActions } from "./settings-screen";

/** 저장한 뒤 성공이면 화면 값을 다시 읽게 감싼다 */
export type ReloadOnSuccess = <I>(
  call: (input: I) => Promise<ActionResult>,
) => (input: I) => Promise<ActionResult>;

/**
 * 저장 행동을 감싸 성공하면 라우터 전체를 다시 읽게 한다. 셸(Workspace 이름, 러너 목록)도 바뀔 수 있어서다.
 */
export function useReloadOnSuccess(): ReloadOnSuccess {
  const router = useRouter();
  return useMemo(
    (): ReloadOnSuccess => (call) => async (input) => {
      const result = await call(input);
      if (result.ok) await router.invalidate();
      return result;
    },
    [router],
  );
}

/**
 * Settings 의 저장·확인 행동을 server function 에 잇는다. Settings 와 온보딩(0026)이 함께 쓴다.
 * 저장에 성공하면 화면 값을 다시 읽는다.
 */
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
      saveConnection: then((data) => saveTrackerConnection({ data })),
      checkConnection: (data) => checkTrackerConnectionNow({ data }),
      saveGitHubToken: then((data) => saveGitHubTokenSetting({ data })),
      checkGitHubToken: () => checkGitHubTokenNow(),
      saveRunner: then((data) => saveRunnerSettings({ data })),
      recheckRunner: then((data) => requestRunnerCheckNow({ data })),
      saveAddresses: then((data) => saveAddressesSetting({ data })),
      // 기다리는 동안은 요청 상태만 읽고, 결과가 오면 화면 전체를 다시 읽는다(트래커 API 를 아낀다)
      pollRunnerChecks: async () => {
        const pending = await getRunnerChecksPending();
        if (!pending) await router.invalidate();
        return pending;
      },
    }),
    [router, then],
  );
}
