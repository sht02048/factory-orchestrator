import { isAbsolute } from "node:path";
import { HOME_ENV } from "@ganger/cli/home";
import { powerSettingsStore } from "@ganger/app/power-settings";
import { z } from "zod";
import type { PowerSettingsStore } from "@ganger/app/settings/load";

const installHomeSchema = z.object({
  [HOME_ENV]: z.string().trim().min(1).refine(isAbsolute),
});

export function installPowerSettings(
  env: Readonly<Record<string, string | undefined>>,
): PowerSettingsStore | undefined {
  const parsed = installHomeSchema.safeParse(env);
  if (!parsed.success) return undefined;
  return powerSettingsStore(parsed.data[HOME_ENV]);
}
