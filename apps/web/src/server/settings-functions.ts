import { parseBootConfig } from "@factory/db";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import {
  addTrackerProject,
  addTrackerProjectInput,
  addressesInput,
  checkGitHubToken,
  checkTrackerConnection,
  connectionIdInput,
  generalInput,
  githubTokenInput,
  inProgressInput,
  labelInput,
  mappingInput,
  removeTrackerProject,
  requestRunnerCheckSetting,
  runnerIdInput,
  runnerInput,
  saveAddresses,
  saveGeneral,
  saveGitHubToken,
  saveInProgressState,
  saveLabel,
  saveMappingSetting,
  saveRunnerSetting,
  saveTrackerConnectionSetting,
  trackerConnectionInput,
  trackerProjectInput,
} from "../settings/actions";
import { hasPendingRunnerChecks, loadSettingsPage } from "../settings/load";
import type { SettingsContext } from "../settings/load";
import { getAdapterRegistry, getSecretBox } from "./adapters";
import { getDatabase } from "./database";

/*
 * Settings 화면의 server function(0025). 실제 일은 SettingsContext 를 받는 settings/ 함수에 있어
 * 테스트는 테스트 DB 와 가짜 어댑터로 그 함수를 부른다. web 은 ssh 를 쓰지 않는다(Q61).
 */

function context(): SettingsContext {
  return { db: getDatabase(), secretBox: getSecretBox(), registry: getAdapterRegistry() };
}

export const getSettingsPage = createServerFn({ method: "GET" })
  .validator(z.object({ ws: z.string().optional() }))
  .handler(({ data }) => loadSettingsPage(context(), data.ws, new Date()));

/** 러너 확인 결과를 기다리는 동안 부른다. DB 만 읽고 트래커를 부르지 않는다 */
export const getRunnerChecksPending = createServerFn({ method: "GET" }).handler(() =>
  hasPendingRunnerChecks(getDatabase()),
);

export const saveWorkspaceGeneral = createServerFn({ method: "POST" })
  .validator(generalInput)
  .handler(({ data }) => saveGeneral(context(), data));

export const addWorkspaceTrackerProject = createServerFn({ method: "POST" })
  .validator(addTrackerProjectInput)
  .handler(({ data }) => addTrackerProject(context(), data));

export const removeWorkspaceTrackerProject = createServerFn({ method: "POST" })
  .validator(trackerProjectInput)
  .handler(({ data }) => removeTrackerProject(context(), data));

export const saveWorkspaceMapping = createServerFn({ method: "POST" })
  .validator(mappingInput)
  .handler(({ data }) => saveMappingSetting(context(), data));

export const saveWorkspaceInProgressState = createServerFn({ method: "POST" })
  .validator(inProgressInput)
  .handler(({ data }) => saveInProgressState(context(), data));

export const saveWorkspaceLabel = createServerFn({ method: "POST" })
  .validator(labelInput)
  .handler(({ data }) => saveLabel(context(), data));

export const saveTrackerConnection = createServerFn({ method: "POST" })
  .validator(trackerConnectionInput)
  .handler(({ data }) => saveTrackerConnectionSetting(context(), data, new Date()));

export const checkTrackerConnectionNow = createServerFn({ method: "POST" })
  .validator(connectionIdInput)
  .handler(({ data }) => checkTrackerConnection(context(), data));

export const saveGitHubTokenSetting = createServerFn({ method: "POST" })
  .validator(githubTokenInput)
  .handler(({ data }) => saveGitHubToken(context(), data, new Date()));

export const checkGitHubTokenNow = createServerFn({ method: "POST" }).handler(() =>
  checkGitHubToken(context()),
);

export const saveRunnerSettings = createServerFn({ method: "POST" })
  .validator(runnerInput)
  .handler(({ data }) => saveRunnerSetting(context(), data, new Date()));

export const requestRunnerCheckNow = createServerFn({ method: "POST" })
  .validator(runnerIdInput)
  .handler(({ data }) => requestRunnerCheckSetting(context(), data, new Date()));

/** 다른 기기에서 열 주소와 webhook 공개 주소(0048). 저장하면 지금 보는 화면이 막히는지 요청의 Host 로 본다 */
export const saveAddressesSetting = createServerFn({ method: "POST" })
  .validator(addressesInput)
  .handler(({ data }) =>
    saveAddresses(context(), data, new Date(), {
      host: getRequestHeader("host") ?? null,
      bindHost: parseBootConfig(process.env).host,
    }),
  );
