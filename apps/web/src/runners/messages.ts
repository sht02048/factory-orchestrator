import runners from "../../messages/ko/runners.json" with { type: "json" };

declare module "../i18n" {
  interface AppMessages {
    runners: typeof runners;
  }
}

export const runnersMessages = { runners };
