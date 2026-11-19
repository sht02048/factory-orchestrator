import { useRouter } from "@tanstack/react-router";
import { useMemo } from "react";
import { getThisMacStatus, runThisMacStep } from "../server/runner-setup-functions";
import type { RunnerSetupActions } from "./runner-setup";

export function useRunnerSetupActions(): RunnerSetupActions {
  const router = useRouter();
  return useMemo(
    (): RunnerSetupActions => ({
      thisMacStatus: () => getThisMacStatus(),
      runThisMacStep: async (step) => {
        const outcome = await runThisMacStep({ data: { step } });
        if (outcome.runnerId !== null) await router.invalidate();
        return outcome;
      },
    }),
    [router],
  );
}
