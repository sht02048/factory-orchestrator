import { parseBootConfig } from "@ganger/db";
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

function context(): SettingsContext {
  return { db: getDatabase(), secretBox: getSecretBox(), registry: getAdapterRegistry() };
}

export const getSettingsPage = createServerFn({ method: "GET" })
  .validator(z.object({ ws: z.string().optional() }))
  .handler(({ data }) => loadSettingsPage(context(), data.ws, new Date()));

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

export const saveAddressesSetting = createServerFn({ method: "POST" })
  .validator(addressesInput)
  .handler(({ data }) =>
    saveAddresses(context(), data, new Date(), {
      host: getRequestHeader("host") ?? null,
      bindHost: parseBootConfig(process.env).host,
    }),
  );
