import { hostname, homedir, release } from "node:os";
import { isAbsolute } from "node:path";
import { HOME_ENV, PRODUCT_NAME } from "@ganger/cli/home";
import { toRunId } from "@ganger/core";
import { listRuns, parseBootConfig } from "@ganger/db";
import { GANGER_VERSION, log, logDir, readDebugSwitch, writeDebugSwitch } from "@ganger/log";
import { buildDiagnostics, folderSummary } from "@ganger/app/diagnostics/bundle";
import type { DiagnosticsBundle } from "@ganger/app/diagnostics/bundle";
import { RUN_CHOICES, shownPath } from "@ganger/app/diagnostics/model";
import type { BrowserErrorInput, LogSettingsView } from "@ganger/app/diagnostics/model";
import { runModeOf } from "@ganger/app/diagnostics/run-mode";
import type { SaveResult } from "@ganger/app/settings/model";
import { z } from "zod";
import { getDatabase } from "./database";

type Env = Readonly<Record<string, string | undefined>>;

const installHomeSchema = z.object({ [HOME_ENV]: z.string().trim().min(1).refine(isAbsolute) });

export function installHome(env: Env): string | null {
  const parsed = installHomeSchema.safeParse(env);
  return parsed.success ? parsed.data[HOME_ENV] : null;
}

export function readLogSettingsView(env: Env): LogSettingsView {
  const home = installHome(env);
  if (home === null) return { available: false };
  const folder = logDir(home);
  return {
    available: true,
    folder,
    folderShown: shownPath(folder, homedir()),
    totalBytes: folderSummary(folder).totalBytes,
    debug: readDebugSwitch(home),
    runs: listRuns(getDatabase(), { order: "newest", limit: RUN_CHOICES }).map((run) => ({
      id: run.id,
      ticketKey: run.ticket.key,
      state: run.state,
    })),
  };
}

export function saveDebugLog(env: Env, debug: boolean): SaveResult<"unavailable"> {
  const home = installHome(env);
  if (home === null) return { ok: false, reason: "unavailable" };
  writeDebugSwitch(home, debug);
  return { ok: true };
}

function databasePath(env: Env): string | null {
  try {
    return parseBootConfig(env).databasePath;
  } catch {
    return null;
  }
}

export function makeDiagnostics(
  env: Env,
  request: { anonymize: boolean; runId: string | null },
  now: Date,
): DiagnosticsBundle {
  const home = installHome(env);
  const bundle = buildDiagnostics({
    db: getDatabase(),
    gangerHome: home,
    databasePath: databasePath(env),
    system: {
      version: GANGER_VERSION,
      node: process.version,
      platform: process.platform,
      release: release(),
      arch: process.arch,
      hostname: hostname(),
      userHome: homedir(),
      runMode: runModeOf(env, PRODUCT_NAME),
      report: () => {
        const report = process.report;
        const excluded = report.excludeEnv;
        report.excludeEnv = true;
        try {
          return report.getReport();
        } finally {
          report.excludeEnv = excluded;
        }
      },
    },
    debug: home === null ? false : readDebugSwitch(home),
    anonymize: request.anonymize,
    runId: request.runId === null ? null : toRunId(request.runId),
    now,
  });
  log().info("diagnostics.created", {
    count: bundle.files.length,
    kind: request.anonymize ? "anonymized" : "plain",
  });
  return bundle;
}

const BROWSER_ERRORS_PER_MINUTE = 30;
let windowStart = 0;
let windowCount = 0;

export function recordBrowserError(input: BrowserErrorInput, now: number): void {
  if (now - windowStart >= 60_000) {
    windowStart = now;
    windowCount = 0;
  }
  windowCount += 1;
  if (windowCount > BROWSER_ERRORS_PER_MINUTE) return;
  const error = new Error(input.message);
  error.name = "BrowserError";
  error.stack = input.stack ?? `BrowserError: ${input.message}`;
  log().error("browser.error", { kind: input.kind, path: input.path, error });
}
