import { createServerFn } from "@tanstack/react-start";
import { firstWorkspaceInput, isOnboardingComplete, setUpFirstWorkspace } from "../onboarding/load";
import { loadTrackerProjectChoices, loadSettingsPage } from "../settings/load";
import type { SettingsContext } from "../settings/load";
import { getAdapterRegistry, getSecretBox } from "./adapters";
import { getDatabase } from "./database";

function context(): SettingsContext {
  return { db: getDatabase(), secretBox: getSecretBox(), registry: getAdapterRegistry() };
}

export const getOnboardingComplete = createServerFn({ method: "GET" }).handler(() =>
  isOnboardingComplete(getDatabase(), getSecretBox()),
);

export const getOnboardingPage = createServerFn({ method: "GET" }).handler(async () => {
  const page = await loadSettingsPage(context(), undefined, new Date());
  const trackerProjects =
    page.workspace?.trackerProjects ??
    (page.install.connections.length === 0 ? [] : await loadTrackerProjectChoices(context(), null));
  return { page, trackerProjects };
});

export const setUpWorkspace = createServerFn({ method: "POST" })
  .validator(firstWorkspaceInput)
  .handler(({ data }) => setUpFirstWorkspace(context(), data, new Date()));
