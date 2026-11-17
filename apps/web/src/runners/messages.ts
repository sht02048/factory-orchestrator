import runners from "../../messages/ko/runners.json" with { type: "json" };

// Runners 화면의 메시지 파일. 라우트가 ScreenMessages 로 싣는다(i18n.tsx).
declare module "../i18n" {
  interface AppMessages {
    runners: typeof runners;
  }
}

export const runnersMessages = { runners };
