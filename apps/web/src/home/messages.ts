import home from "../../messages/ko/home.json" with { type: "json" };

// 홈 화면의 메시지 파일. 라우트가 ScreenMessages 로 싣는다(i18n.tsx).
declare module "../i18n" {
  interface AppMessages {
    home: typeof home;
  }
}

export const homeMessages = { home };
