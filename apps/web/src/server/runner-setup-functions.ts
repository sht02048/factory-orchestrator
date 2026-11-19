import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { THIS_MAC_STEPS } from "@ganger/app/runner-setup/model";
import { registerThisMac } from "@ganger/app/runner-setup/register";
import type { RegisterResult } from "@ganger/app/runner-setup/register";
import { getInstallSettings, parseBootConfig } from "@ganger/db";
import { getRequestHeader } from "@tanstack/react-start/server";
import { addressesInput, saveAddresses } from "@ganger/app/settings/actions";
import { startAppEnrollment, startEnrollment } from "@ganger/app/runner-setup/enrollment";
import type {
  EnrollmentView,
  StartAppEnrollmentResult,
  StartEnrollmentResult,
} from "@ganger/app/runner-setup/enrollment";
import {
  getAdapterRegistry,
  getGangerSsh,
  getRunnerEnrollments,
  getSecretBox,
  getThisMac,
} from "./adapters";
import { getDatabase } from "./database";

export const getThisMacStatus = createServerFn({ method: "GET" }).handler(() =>
  getThisMac().status(),
);

export const runThisMacStep = createServerFn({ method: "POST" })
  .validator(z.object({ step: z.enum(THIS_MAC_STEPS) }))
  .handler(async ({ data }): Promise<RegisterResult> => {
    const mac = getThisMac();
    if (data.step === "register") {
      const context = {
        db: getDatabase(),
        secretBox: getSecretBox(),
        registry: getAdapterRegistry(),
      };
      return registerThisMac(context, mac, new Date());
    }
    const status = await mac.status();
    if (!status.remoteLogin && (data.step === "key" || data.step === "hostKey")) {
      return {
        result: { step: data.step, outcome: "failed", problem: "remote-login-off", detail: null },
        runnerId: null,
      };
    }
    return { result: await mac.runStep(data.step), runnerId: null };
  });

const enrollmentId = z.object({ id: z.uuid() });

export const startRunnerEnrollment = createServerFn({ method: "POST" })
  .validator(z.object({ replacing: z.uuid().optional() }))
  .handler(({ data }): Promise<StartEnrollmentResult> =>
    startEnrollment({
      enrollments: getRunnerEnrollments(),
      ssh: getGangerSsh(),
      webAddress: getInstallSettings(getDatabase()).webAddress,
      replacing: data.replacing,
    }),
  );

export const startAppRunnerEnrollment = createServerFn({ method: "POST" })
  .validator(z.object({ replacing: z.uuid().optional() }))
  .handler(({ data }): Promise<StartAppEnrollmentResult> =>
    startAppEnrollment({
      enrollments: getRunnerEnrollments(),
      ssh: getGangerSsh(),
      webAddress: getInstallSettings(getDatabase()).webAddress,
      replacing: data.replacing,
    }),
  );

export const getRunnerEnrollment = createServerFn({ method: "GET" })
  .validator(enrollmentId)
  .handler(({ data }): EnrollmentView => getRunnerEnrollments().view(data.id));

export const cancelRunnerEnrollment = createServerFn({ method: "POST" })
  .validator(enrollmentId)
  .handler(({ data }): { ok: true } => {
    getRunnerEnrollments().revoke(data.id);
    return { ok: true };
  });

export const saveEnrollmentWebAddress = createServerFn({ method: "POST" })
  .validator(addressesInput.pick({ webAddress: true }))
  .handler(({ data }) => {
    const context = {
      db: getDatabase(),
      secretBox: getSecretBox(),
      registry: getAdapterRegistry(),
    };
    const { webhookAddress } = getInstallSettings(context.db);
    return saveAddresses(
      context,
      { webAddress: data.webAddress, webhookAddress: webhookAddress ?? "" },
      new Date(),
      { host: getRequestHeader("host") ?? null, bindHost: parseBootConfig(process.env).host },
    );
  });
