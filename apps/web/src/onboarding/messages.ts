import onboarding from "../../messages/ko/onboarding.json" with { type: "json" };
import { settingsMessages } from "../settings/messages";

// 온보딩 화면의 메시지 파일. 입력 폼은 Settings 의 것을 다시 쓰므로 Settings 메시지도 함께 싣는다.
declare module "../i18n" {
  interface AppMessages {
    onboarding: typeof onboarding;
  }
}

export const onboardingMessages = { ...settingsMessages, onboarding };
