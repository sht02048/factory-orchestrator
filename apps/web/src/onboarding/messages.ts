import onboarding from "../../messages/ko/onboarding.json" with { type: "json" };
import { settingsMessages } from "../settings/messages";

declare module "../i18n" {
  interface AppMessages {
    onboarding: typeof onboarding;
  }
}

export const onboardingMessages = { ...settingsMessages, onboarding };
