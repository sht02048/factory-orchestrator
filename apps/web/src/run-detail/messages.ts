import run from "../../messages/ko/run.json" with { type: "json" };

declare module "../i18n" {
  interface AppMessages {
    run: typeof run;
  }
}

export const runMessages = { run };
