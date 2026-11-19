import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { THIS_MAC_STEPS } from "@ganger/app/runner-setup/model";
import { registerThisMac } from "@ganger/app/runner-setup/register";
import type { RegisterResult } from "@ganger/app/runner-setup/register";
import { getAdapterRegistry, getSecretBox, getThisMac } from "./adapters";
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
