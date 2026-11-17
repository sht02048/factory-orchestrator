import ds from "../../messages/ko/ds.json" with { type: "json" };

// 디자인 시스템 미리보기(/ds)의 메시지 파일.
declare module "../i18n" {
  interface AppMessages {
    ds: typeof ds;
  }
}

export const dsMessages = { ds };
