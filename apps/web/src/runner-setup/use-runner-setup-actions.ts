import { useRouter } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  cancelRunnerEnrollment,
  getRunnerEnrollment,
  getThisMacStatus,
  runThisMacStep,
  saveEnrollmentWebAddress,
  startRunnerEnrollment,
} from "../server/runner-setup-functions";
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
      startEnrollment: (replacing) =>
        startRunnerEnrollment({ data: replacing === undefined ? {} : { replacing } }),
      enrollment: async (id) => {
        const view = await getRunnerEnrollment({ data: { id } });
        if (view.state === "registered") await router.invalidate();
        return view;
      },
      saveWebAddress: (webAddress) => saveEnrollmentWebAddress({ data: { webAddress } }),
      cancelEnrollment: async (id) => {
        await cancelRunnerEnrollment({ data: { id } });
      },
    }),
    [router],
  );
}
