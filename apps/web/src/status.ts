import type { PillStatus, SummaryStatus } from "@factory/ui";
import { useTranslations } from "use-intl";

/*
 * 상태 알약(StatusPill)의 값과 이름. 이름은 GLOSSARY 영어 용어이고 domain 메시지에 있다(ADR 0010 1번).
 * 화면은 상태 값을 runStatus 같은 함수로 고르고 이름은 useStatusName 으로 가져온다. 색은 알약이 고른다.
 */

/** 런의 상태 칸: Ended 는 요약 결과, 그 밖은 런 상태 */
export type RunStatusInput =
  | { state: "queued" | "running" | "waiting-for-input" | "disconnected" }
  | { state: "ended"; summary: SummaryStatus };

export function runStatus(run: RunStatusInput): PillStatus {
  return run.state === "ended" ? run.summary : run.state;
}

/** 상태 값의 화면 이름 */
export function useStatusName(): (status: PillStatus) => string {
  const t = useTranslations("domain");
  return (status) => {
    switch (status) {
      case "queued":
      case "running":
      case "waiting-for-input":
      case "disconnected":
        return t(`runState.${status}`);
      case "merged":
      case "human-check":
      case "failed":
      case "canceled":
        return t(`summary.${status}`);
      case "online":
      case "offline":
        return t(`runnerState.${status}`);
      case "question":
      case "permission":
      case "runner-issue":
        return t(`attention.${status}`);
    }
  };
}
