import runs from "../../messages/ko/runs.json" with { type: "json" };

declare module "../i18n" {
  interface AppMessages {
    runs: typeof runs;
  }
}

export const runsMessages = { runs };
