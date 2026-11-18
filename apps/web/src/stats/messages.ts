import stats from "../../messages/ko/stats.json" with { type: "json" };

declare module "../i18n" {
  interface AppMessages {
    stats: typeof stats;
  }
}

export const statsMessages = { stats };
