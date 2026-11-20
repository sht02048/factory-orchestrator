import { useMemo } from "react";
import type { AfterSave } from "../settings/use-settings-actions";
import {
  cancelRunnerEnrollment,
  getRunnerEnrollment,
  getThisMacStatus,
  runThisMacStep,
  saveEnrollmentWebAddress,
  startAppRunnerEnrollment,
  startRunnerEnrollment,
} from "../server/runner-setup-functions";
import type { RunnerSetupActions } from "./runner-setup";

export function useRunnerSetupActions(afterRunnerAdded: AfterSave): RunnerSetupActions {
  return useMemo(
    (): RunnerSetupActions => ({
      thisMacStatus: () => getThisMacStatus(),
      runThisMacStep: async (step) => {
        const outcome = await runThisMacStep({ data: { step } });
        if (outcome.runnerId !== null) await afterRunnerAdded();
        return outcome;
      },
      startEnrollment: (replacing) =>
        startRunnerEnrollment({ data: replacing === undefined ? {} : { replacing } }),
      startAppEnrollment: (replacing) =>
        startAppRunnerEnrollment({ data: replacing === undefined ? {} : { replacing } }),
      enrollment: async (id) => {
        const view = await getRunnerEnrollment({ data: { id } });
        if (view.state === "registered") await afterRunnerAdded();
        return view;
      },
      saveWebAddress: (webAddress) => saveEnrollmentWebAddress({ data: { webAddress } }),
      cancelEnrollment: async (id) => {
        await cancelRunnerEnrollment({ data: { id } });
      },
    }),
    [afterRunnerAdded],
  );
}
