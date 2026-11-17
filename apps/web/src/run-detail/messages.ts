import run from "../../messages/ko/run.json" with { type: "json" };

// Run 상세 화면의 메시지 파일. 라우트가 ScreenMessages 로 싣는다(i18n.tsx).
declare module "../i18n" {
  interface AppMessages {
    run: typeof run;
  }
}

export const runMessages = { run };
