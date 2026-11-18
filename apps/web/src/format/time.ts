import { useFormatter, useTranslations } from "use-intl";
import { DAY_MS } from "../time-zone";

/*
 * 시간 표기(ADR 0010 7번). 화면은 시간을 따로 만들지 않고 이 모듈만 쓴다.
 *
 * - 진행 중인 것은 경과: "25분째", "1시간 10분째".
 * - 지난 일은 상대 시간: 1분 안이면 "방금", "25분 전", "3시간 전", 하루가 넘으면 날짜("11월 17일").
 * - 타임라인은 시각: "10:45".
 * - 기다린 시간·통계 같은 시간의 양은 "12분", "1시간 5분".
 *
 * 시각과 날짜는 운영자 시간대(time-zone.ts, 티켓 0044)로 그린다. 시간대는 루트의 IntlProvider 가 주고
 * use-intl 포매터가 쓴다. "지금"은 서버가 데이터를 읽을 때 정해 경과 밀리초로 넘긴다. 화면이 Date.now() 로
 * 다시 재면 서버 렌더와 hydration 이 다른 값을 그린다.
 */

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

export interface TimeFormat {
  /** 시간의 양: "12분", "1시간 5분", 1분 안이면 "40초" */
  duration: (ms: number) => string;
  /** 진행 중인 것의 경과: "25분째" */
  elapsed: (ms: number) => string;
  /** 지난 일: "방금", "25분 전", "3시간 전", 하루가 넘으면 그 날짜. `agoMs` 는 그 일부터 지금까지 */
  ago: (at: Date | string, agoMs: number) => string;
  /** 타임라인 시각: "10:45" */
  clock: (at: Date | string) => string;
}

export function useTime(): TimeFormat {
  const t = useTranslations("domain");
  const format = useFormatter();

  const duration = (ms: number): string => {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    if (totalSeconds < 60) return t("duration.seconds", { seconds: totalSeconds });
    const totalMinutes = Math.floor(totalSeconds / 60);
    if (totalMinutes < 60) return t("duration.minutes", { minutes: totalMinutes });
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes === 0
      ? t("duration.hours", { hours })
      : t("duration.hoursMinutes", { hours, minutes });
  };

  return {
    duration,
    elapsed: (ms) => t("time.elapsed", { duration: duration(ms) }),
    ago: (at, agoMs) => {
      if (agoMs < MINUTE_MS) return t("time.justNow");
      if (agoMs < HOUR_MS)
        return t("time.ago", {
          duration: t("duration.minutes", { minutes: Math.floor(agoMs / MINUTE_MS) }),
        });
      if (agoMs < DAY_MS)
        return t("time.ago", {
          duration: t("duration.hours", { hours: Math.floor(agoMs / HOUR_MS) }),
        });
      return format.dateTime(toDate(at), { month: "long", day: "numeric" });
    },
    clock: (at) =>
      format.dateTime(toDate(at), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  };
}

function toDate(at: Date | string): Date {
  return typeof at === "string" ? new Date(at) : at;
}
