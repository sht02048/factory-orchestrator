import home from "../../messages/ko/home.json" with { type: "json" };

declare module "../i18n" {
  interface AppMessages {
    home: typeof home;
  }
}

export const homeMessages = { home };
