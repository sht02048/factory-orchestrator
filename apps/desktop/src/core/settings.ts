import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

export const appSettingsSchema = z.object({
  mode: z.enum(["local", "remote"]).optional(),
  remote: z.object({ instanceId: z.string(), name: z.string(), url: z.string() }).optional(),
  openAtLogin: z.boolean().optional(),
  discoveryPort: z.number().int().min(1).max(65_535).optional(),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export interface SettingsStore {
  read(): AppSettings;
  write(settings: AppSettings): void;
}

export function fileSettingsStore(path: string): SettingsStore {
  return {
    read: () => {
      try {
        const parsed = appSettingsSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
        return parsed.success ? parsed.data : {};
      } catch {
        return {};
      }
    },
    write: (settings) => {
      mkdirSync(dirname(path), { recursive: true });
      const temp = `${path}.tmp`;
      writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`);
      renameSync(temp, path);
    },
  };
}
