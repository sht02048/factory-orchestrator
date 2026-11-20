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
  createAutoAssignLabel,
  createLabelInput,
  generalInput,
  githubTokenInput,
  inProgressInput,
  labelInput,
  mappingStateInput,
  mcpWriteInput,
  powerInput,
  removeTrackerProject,
  requestRunnerCheckSetting,
  runnerIdInput,
  runnerInput,
  saveAddresses,
  saveGeneral,
  saveGitHubToken,
  saveInProgressState,
  saveLabel,
  saveMappingState,
  saveMcpWriteSetting,
  savePowerSetting,
  saveTrackerConnectionSetting,
  trackerConnectionInput,
  trackerProjectInput,
  turnOffWebhook,
  verifyWebhookAddress,
  webhookAddressInput,
  webhookStateNow,
} from "@ganger/app/settings/actions";
import { funnelAddress, funnelCommand } from "@ganger/app/webhook-address";
import type { WebhookSetupView } from "@ganger/app/settings/model";
import { GANGER_YELLOW_HEX } from "@ganger/ui/brand-color";
import { saveRunnerFindingOrca } from "@ganger/app/runner-setup/remote-orca";
import { hasPendingRunnerChecks, loadSettingsPage } from "@ganger/app/settings/load";
import type { SettingsContext } from "@ganger/app/settings/load";
import { getAdapterRegistry, getSecretBox } from "./adapters";
import { getDatabase } from "./database";
import { serverMcpLaunch } from "./mcp-launch";
import { installPowerSettings } from "./power-settings";
import { getTrackerReads } from "./tracker-reads";
import { getThisTailnetDevice, getWebhookPingFetch } from "./webhook-reach";

function context(): SettingsContext {
  const power = installPowerSettings(process.env);
  return {
    db: getDatabase(),
    secretBox: getSecretBox(),
    registry: getAdapterRegistry(),
    mcpLaunch: serverMcpLaunch(process.env, process.execPath),
    trackerReads: getTrackerReads(),
    ...(power === undefined ? {} : { power }),
  };
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
  .validator(mappingStateInput)
  .handler(({ data }) => saveMappingState(context(), data));

export const saveWorkspaceInProgressState = createServerFn({ method: "POST" })
  .validator(inProgressInput)
  .handler(({ data }) => saveInProgressState(context(), data));

export const saveWorkspaceLabel = createServerFn({ method: "POST" })
  .validator(labelInput)
  .handler(({ data }) => saveLabel(context(), data));

export const createWorkspaceAutoAssignLabel = createServerFn({ method: "POST" })
  .validator(createLabelInput)
  .handler(({ data }) => createAutoAssignLabel(context(), data, GANGER_YELLOW_HEX));

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
  .handler(({ data }) => saveRunnerFindingOrca(context(), data, new Date()));

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

export const savePowerSettings = createServerFn({ method: "POST" })
  .validator(powerInput)
  .handler(({ data }) => savePowerSetting(context(), data));

export const saveMcpWriteSettings = createServerFn({ method: "POST" })
  .validator(mcpWriteInput)
  .handler(({ data }) => saveMcpWriteSetting(context(), data, new Date()));

export const turnOffTrackerWebhook = createServerFn({ method: "POST" })
  .validator(connectionIdInput)
  .handler(({ data }) => turnOffWebhook(context(), data, new Date()));

export const getTrackerWebhookState = createServerFn({ method: "GET" })
  .validator(connectionIdInput)
  .handler(({ data }) => webhookStateNow(context(), data, new Date()));

export const checkWebhookAddressNow = createServerFn({ method: "POST" })
  .validator(webhookAddressInput)
  .handler(({ data }) => verifyWebhookAddress(context(), data, new Date(), getWebhookPingFetch()));

function webPort(): number {
  try {
    return parseBootConfig(process.env).port;
  } catch {
    return 3000;
  }
}

export const getWebhookSetup = createServerFn({ method: "GET" }).handler(
  async (): Promise<WebhookSetupView> => {
    const device = await getThisTailnetDevice();
    return {
      funnel:
        device === null
          ? null
          : { command: funnelCommand(device.cli, webPort()), address: funnelAddress(device.host) },
    };
  },
);
