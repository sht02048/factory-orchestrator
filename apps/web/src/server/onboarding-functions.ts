import { createServerFn } from "@tanstack/react-start";
import {
  createFirstWorkspace,
  firstWorkspaceInput,
  isOnboardingComplete,
} from "../onboarding/load";
import { getSecretBox } from "./adapters";
import { getDatabase } from "./database";

export const getOnboardingComplete = createServerFn({ method: "GET" }).handler(() =>
  isOnboardingComplete(getDatabase(), getSecretBox()),
);

export const createWorkspace = createServerFn({ method: "POST" })
  .validator(firstWorkspaceInput)
  .handler(({ data }) => createFirstWorkspace(getDatabase(), data, new Date()));
