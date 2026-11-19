import runnerSetup from "../../messages/ko/runnerSetup.json" with { type: "json" };

declare module "../i18n" {
  interface AppMessages {
    runnerSetup: typeof runnerSetup;
  }
}

export const runnerSetupMessages = { runnerSetup };
