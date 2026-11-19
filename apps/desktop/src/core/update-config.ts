import { readFileSync } from "node:fs";
import { repositorySchema } from "@ganger/app/updates/releases";
import type { ManualReason } from "@ganger/app/updates/view";
import { z } from "zod";

export const UPDATE_CONFIG_FILE = "app-update.json";
export const UPDATE_REPOSITORY_ENV = "GANGER_UPDATE_REPOSITORY";

const updateConfigSchema = z.object({ repository: repositorySchema });

export function updateRepository(
  configFile: string | null,
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  const override = repositorySchema.safeParse(env[UPDATE_REPOSITORY_ENV]);
  if (override.success) return override.data;
  if (configFile === null) return null;
  try {
    const parsed = updateConfigSchema.safeParse(JSON.parse(readFileSync(configFile, "utf8")));
    return parsed.success ? parsed.data.repository : null;
  } catch {
    return null;
  }
}

export function updateConfigJson(repository: string): string {
  return `${JSON.stringify(updateConfigSchema.parse({ repository }), null, 2)}\n`;
}

export interface InstallLocation {
  inApplications: boolean;
  writable: boolean;
}

export function blockedReason(location: InstallLocation): ManualReason | null {
  if (!location.inApplications) return "outside-applications";
  if (!location.writable) return "no-permission";
  return null;
}

export async function fetchReleases(url: string, timeoutMs = 10_000): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`releases request failed with ${response.status}`);
  const body: unknown = await response.json();
  return body;
}
