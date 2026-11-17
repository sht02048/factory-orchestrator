import stats from "../../messages/ko/stats.json" with { type: "json" };

// Stats 화면의 메시지 파일. 라우트가 ScreenMessages 로 싣는다(i18n.tsx).
declare module "../i18n" {
  interface AppMessages {
    stats: typeof stats;
  }
}

export const statsMessages = { stats };
