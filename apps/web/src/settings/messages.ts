import settings from "../../messages/ko/settings.json" with { type: "json" };

// Settings 화면의 메시지 파일. 라우트가 ScreenMessages 로 싣는다(i18n.tsx).
declare module "../i18n" {
  interface AppMessages {
    settings: typeof settings;
  }
}

export const settingsMessages = { settings };
