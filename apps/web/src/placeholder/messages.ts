import placeholder from "../../messages/ko/placeholder.json" with { type: "json" };

// 아직 없는 화면의 빈 자리. 새 화면 메시지 파일을 더하는 예이기도 하다: i18n.tsx 를 고치지 않고
// 이 모듈에서 타입을 더하고 라우트가 ScreenMessages 로 싣는다.
declare module "../i18n" {
  interface AppMessages {
    placeholder: typeof placeholder;
  }
}

export const placeholderMessages = { placeholder };
