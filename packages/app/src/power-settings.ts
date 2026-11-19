import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const POWER_SETTINGS_FILE = "power.json";

export const powerSettingsSchema = z.object({ preventSleep: z.boolean() });
export type PowerSettings = z.infer<typeof powerSettingsSchema>;

export const DEFAULT_POWER_SETTINGS: PowerSettings = { preventSleep: true };

export interface PowerSettingsRead {
  settings: PowerSettings;
  problem: string | undefined;
}

export function powerSettingsPath(home: string): string {
  return join(home, POWER_SETTINGS_FILE);
}

export function readPowerSettings(home: string): PowerSettingsRead {
  const path = powerSettingsPath(home);
  if (!existsSync(path)) return { settings: DEFAULT_POWER_SETTINGS, problem: undefined };
  let parsed;
  try {
    parsed = powerSettingsSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { settings: DEFAULT_POWER_SETTINGS, problem: `${path}: ${reason}` };
  }
  if (!parsed.success) {
    return {
      settings: DEFAULT_POWER_SETTINGS,
      problem: `${path}: expected {"preventSleep": true | false}`,
    };
  }
  return { settings: parsed.data, problem: undefined };
}

export function writePowerSettings(home: string, settings: PowerSettings): void {
  mkdirSync(home, { recursive: true });
  const path = powerSettingsPath(home);
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(powerSettingsSchema.parse(settings))}\n`, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, path);
}

export interface PowerSettingsStore {
  read(): PowerSettings;
  write(settings: PowerSettings): void;
}

export function powerSettingsStore(home: string): PowerSettingsStore {
  return {
    read: () => readPowerSettings(home).settings,
    write: (settings) => writePowerSettings(home, settings),
  };
}
