import { useTranslations } from "use-intl";

/** UTC 날짜(0시 epoch 밀리초)를 "11월 4일"(long)과 그래프 눈금용 "11/4"(short)로 쓴다 */
export function useDayLabel(): (day: number) => { long: string; short: string } {
  const t = useTranslations("stats");
  return (day) => {
    const date = new Date(day);
    const parts = { month: date.getUTCMonth() + 1, day: date.getUTCDate() };
    return { long: t("date", parts), short: t("dayShort", parts) };
  };
}
