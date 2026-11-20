import type { RunState } from "@ganger/core";
import { z } from "zod";

export const DIAGNOSTICS_PATH = "/api/diagnostics";
export const DIAGNOSTICS_ANONYMIZE_PARAM = "anonymize";
export const DIAGNOSTICS_RUN_PARAM = "run";
export const RUN_CHOICES = 20;
export const DESKTOP_LOGS_GLOBAL = "gangerDesktopLogs";

export interface DiagnosticsRunChoice {
  id: string;
  ticketKey: string;
  state: RunState;
}

export type LogSettingsView =
  | { available: false }
  | {
      available: true;
      folder: string;
      totalBytes: number;
      debug: boolean;
      runs: DiagnosticsRunChoice[];
    };

export const debugLogInput = z.object({ debug: z.boolean() });

export const BROWSER_ERROR_KINDS = ["error", "unhandled-rejection"] as const;
export const BROWSER_ERROR_MESSAGE_LIMIT = 2_000;
export const BROWSER_ERROR_STACK_LIMIT = 8_000;

export const browserErrorInput = z.object({
  kind: z.enum(BROWSER_ERROR_KINDS),
  message: z.string().max(BROWSER_ERROR_MESSAGE_LIMIT),
  stack: z.string().max(BROWSER_ERROR_STACK_LIMIT).nullable(),
  path: z.string().max(500),
});
export type BrowserErrorInput = z.infer<typeof browserErrorInput>;

export function diagnosticsHref(options: { anonymize: boolean; runId: string | null }): string {
  const search = new URLSearchParams();
  if (!options.anonymize) search.set(DIAGNOSTICS_ANONYMIZE_PARAM, "0");
  if (options.runId !== null) search.set(DIAGNOSTICS_RUN_PARAM, options.runId);
  const query = search.toString();
  return query === "" ? DIAGNOSTICS_PATH : `${DIAGNOSTICS_PATH}?${query}`;
}

export function diagnosticsRequest(url: URL): { anonymize: boolean; runId: string | null } {
  const run = url.searchParams.get(DIAGNOSTICS_RUN_PARAM)?.trim() ?? "";
  return {
    anonymize: url.searchParams.get(DIAGNOSTICS_ANONYMIZE_PARAM) !== "0",
    runId: run === "" ? null : run,
  };
}
