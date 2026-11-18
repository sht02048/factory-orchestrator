import settings from "../../messages/ko/settings.json" with { type: "json" };

declare module "../i18n" {
  interface AppMessages {
    settings: typeof settings;
  }
}

export const settingsMessages = { settings };
