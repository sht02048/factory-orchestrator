import type { ReactNode } from "react";
import { IntlProvider, createTranslator, useMessages, useTimeZone } from "use-intl";
import domain from "../messages/ko/domain.json" with { type: "json" };
import shell from "../messages/ko/shell.json" with { type: "json" };
import { DEFAULT_TIME_ZONE } from "./time-zone";

/*
 * 화면 문구는 messages/{locale}/{파일}.json 에만 둔다(ADR 0005). 지금은 한국어만 채운다.
 *
 * - 앱 전체가 쓰는 파일은 여기서 루트에 싣는다.
 *   shell: 앱 셸(사이드바, Workspace 전환기, 내비), domain: 런 상태·두 축·요약 결과 같은 도메인 낱말.
 * - 화면 파일은 그 화면 모듈이 들여와 ScreenMessages 로 싣고, 같은 모듈에서 AppMessages 에 타입을 더한다.
 *   새 화면 파일을 더해도 이 파일은 고치지 않는다.
 *
 *   import runs from "../../messages/ko/runs.json" with { type: "json" };
 *   declare module "../i18n" {
 *     interface AppMessages { runs: typeof runs }
 *   }
 *   <ScreenMessages messages={{ runs }}>…</ScreenMessages>
 */

/** 메시지 파일 이름(네임스페이스) → 그 파일의 모양. 화면 모듈이 declare module 로 더한다. */
export interface AppMessages {
  shell: typeof shell;
  domain: typeof domain;
}

export const defaultLocale = "ko";

/** 루트에 싣는 공용 메시지 */
export const appMessages = { shell, domain };

declare module "use-intl" {
  interface AppConfig {
    Locale: "ko";
    Messages: AppMessages;
  }
}

/** 라우트 head 처럼 React 밖에서 쓰는 공용 번역 함수 */
export const t = createTranslator({ locale: defaultLocale, messages: appMessages });

/** 화면 하나의 메시지 파일을 바깥 메시지에 더해 싣는다. 시간대는 바깥(루트)의 것을 그대로 쓴다. */
export function ScreenMessages({
  messages,
  children,
}: {
  messages: Partial<AppMessages>;
  children: ReactNode;
}) {
  const parent = useMessages();
  // 루트는 언제나 시간대를 준다. 없으면 UTC 로 그린다.
  const timeZone = useTimeZone() ?? DEFAULT_TIME_ZONE;
  return (
    <IntlProvider locale={defaultLocale} timeZone={timeZone} messages={{ ...parent, ...messages }}>
      {children}
    </IntlProvider>
  );
}
