import runs from "../../messages/ko/runs.json" with { type: "json" };

// Runs 화면의 메시지 파일. 라우트가 ScreenMessages 로 싣는다(i18n.tsx).
declare module "../i18n" {
  interface AppMessages {
    runs: typeof runs;
  }
}

export const runsMessages = { runs };
