import { randomUUID } from "node:crypto";
import { toRunnerId } from "@ganger/core";
import type { RunnerId } from "@ganger/core";
import { listRunners, requestRunnerCheck, saveRunner } from "@ganger/db";
import { z } from "zod";
import { RUNNER_KIND } from "../settings/actions.js";
import type { SettingsContext } from "../settings/load.js";
import type { StepResult, ThisMac } from "./model.js";

export const THIS_MAC_CAPACITY = 1;

const sshTargetOf = z.object({ sshTarget: z.string() }).catch({ sshTarget: "" });
const looseConfig = z.record(z.string(), z.unknown()).catch({});

export interface RegisterResult {
  result: StepResult;
  runnerId: RunnerId | null;
}

export async function registerThisMac(
  context: SettingsContext,
  mac: ThisMac,
  now: Date,
): Promise<RegisterResult> {
  const prepared = await mac.runnerConfig();
  if (!prepared.ok) return { result: prepared.result, runnerId: null };
  const { config } = prepared;
  try {
    const existing = listRunners(context.db).find(
      (runner) => sshTargetOf.parse(runner.config).sshTarget === config.sshTarget,
    );
    const runnerId = existing?.id ?? toRunnerId(randomUUID());
    saveRunner(
      context.db,
      {
        id: runnerId,
        kind: existing?.kind ?? RUNNER_KIND,
        name: existing?.name ?? config.name,
        config: {
          ...looseConfig.parse(existing?.config),
          sshTarget: config.sshTarget,
          orcaPath: config.orcaPath,
          access: config.access,
        },
        capacity: existing?.capacity ?? THIS_MAC_CAPACITY,
      },
      now,
    );
    requestRunnerCheck(context.db, runnerId, now);
    return { result: { step: "register", outcome: "done", detail: config.sshTarget }, runnerId };
  } catch (error) {
    return {
      result: {
        step: "register",
        outcome: "failed",
        problem: "register-failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      runnerId: null,
    };
  }
}
