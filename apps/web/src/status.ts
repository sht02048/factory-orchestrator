import type { PillStatus, SummaryStatus } from "@factory/ui";
import { useTranslations } from "use-intl";

export type RunStatusInput =
  | { state: "queued" | "running" | "waiting-for-input" | "disconnected" }
  | { state: "ended"; summary: SummaryStatus };

export function runStatus(run: RunStatusInput): PillStatus {
  return run.state === "ended" ? run.summary : run.state;
}

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
