import { createTranslator } from "use-intl";
import ko from "../messages/ko.json" with { type: "json" };

// 화면 문구는 messages/{locale}.json 에만 둔다(ADR 0005). 지금은 한국어만 채운다.
export const defaultLocale = "ko";
export const messages = ko;
export const timeZone = "UTC";

declare module "use-intl" {
  interface AppConfig {
    Locale: "ko";
    Messages: typeof ko;
  }
}

// 라우트 head 처럼 React 밖에서 쓰는 번역 함수.
export const t = createTranslator({ locale: defaultLocale, messages: ko });
