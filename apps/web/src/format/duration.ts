import { useTranslations } from "use-intl";

/** 경과 시간·기다린 시간을 "12분", "1시간 5분"처럼 쓴다. 문구는 domain.duration 메시지에 있다. */
export function useFormatDuration(): (ms: number) => string {
  const t = useTranslations("domain.duration");
  return (ms) => {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    if (totalSeconds < 60) return t("seconds", { seconds: totalSeconds });
    const totalMinutes = Math.floor(totalSeconds / 60);
    if (totalMinutes < 60) return t("minutes", { minutes: totalMinutes });
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes === 0 ? t("hours", { hours }) : t("hoursMinutes", { hours, minutes });
  };
}
