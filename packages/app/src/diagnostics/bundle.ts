import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { RunId } from "@ganger/core";
import {
  checkSchema,
  getInstallSettings,
  getMcpWriteAllowed,
  listRecentTrackerEvents,
  listRunners,
  listRuns,
  listTrackerConnectionSummaries,
  listWorkspaceTrackerProjects,
  listWorkspaces,
  runTimeline,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import { isSecretKey, readServerLogs, REDACTED, redactStoredLine, scrubText } from "@ganger/log";
import type { StoredLogLine } from "@ganger/log";
import { z } from "zod";
import { createAnonymizer, hostOfAddress } from "./anonymize.js";
import { writeZip } from "./zip.js";
import type { ZipEntry } from "./zip.js";

export const RECENT_RUNS = 50;
export const RECENT_WEBHOOKS = 100;
export const WARN_LOG_DAYS = 7;
export const RECENT_INFO_LINES = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
const LIFE_EVENTS = new Set([
  "process.started",
  "process.alive",
  "process.stopping",
  "process.stopped",
  "process.crashed",
]);

export interface DiagnosticsSystem {
  version: string;
  node: string;
  platform: string;
  release: string;
  arch: string;
  hostname: string;
  userHome: string;
  runMode: string;
  report(): unknown;
}

export interface DiagnosticsInput {
  db: Database;
  gangerHome: string | null;
  databasePath: string | null;
  system: DiagnosticsSystem;
  debug: boolean;
  anonymize: boolean;
  runId: RunId | null;
  now: Date;
}

export interface DiagnosticsBundle {
  name: string;
  files: ZipEntry[];
  zip: Buffer;
}

const runnerConfigSchema = z.object({ sshTarget: z.string().catch("") }).catch({ sshTarget: "" });

export function buildDiagnostics(input: DiagnosticsInput): DiagnosticsBundle {
  const { db, now, system } = input;
  const logDir = input.gangerHome === null ? null : join(input.gangerHome, "logs");
  const runners = listRunners(db).map((runner) => ({
    ...runner,
    sshTarget: runnerConfigSchema.parse(runner.config).sshTarget,
  }));
  const runs = listRuns(db, { order: "newest", limit: RECENT_RUNS });
  const webhooks = listRecentTrackerEvents(db, RECENT_WEBHOOKS);
  const install = getInstallSettings(db);
  const logs = logDir === null ? [] : bundleLogLines(logDir, now);
  const timeline = input.runId === null ? null : runTimeline(db, input.runId);
  const anonymizer = createAnonymizer({
    sshTargets: runners.map((runner) => runner.sshTarget),
    hosts: [
      system.hostname,
      ...[install.webAddress, install.webhookAddress].flatMap((address) => {
        const host = hostOfAddress(address);
        return host === null ? [] : [host];
      }),
    ],
    runnerNames: runners.map((runner) => runner.name),
    ticketKeys: [
      ...runs.map((run) => run.ticket.key),
      ...webhooks.flatMap((event) => (event.ticketKey === null ? [] : [event.ticketKey])),
      ...(timeline?.runs.map((run) => run.ticketKey) ?? []),
      ...logs.flatMap((line) => {
        const key = line["ticketKey"];
        return typeof key === "string" ? [key] : [];
      }),
    ],
    userHome: system.userHome,
    gangerHome: input.gangerHome,
  });
  const finish = (text: string): string => (input.anonymize ? anonymizer.text(text) : text);
  const json = (value: unknown): string =>
    finish(`${JSON.stringify(redactDeep(value), null, 2)}\n`);

  const files: ZipEntry[] = [
    {
      name: "summary.json",
      text: json({
        createdAt: now.toISOString(),
        anonymized: input.anonymize,
        ganger: system.version,
        node: system.node,
        os: { platform: system.platform, release: system.release, arch: system.arch },
        runMode: system.runMode,
        debugLog: input.debug,
        processes: processLife(logs),
        database: databaseSummary(db, input.databasePath),
        logs: logDir === null ? null : folderSummary(logDir),
      }),
    },
    {
      name: "settings.json",
      text: json({
        workspaces: listWorkspaces(db).map((workspace) => ({
          id: workspace.id,
          maxRunMinutes: Math.round(workspace.maxRunMs / 60_000),
          trackerProjects: listWorkspaceTrackerProjects(db, workspace.id).length,
        })),
        trackerConnections: listTrackerConnectionSummaries(db),
        runners: runners.length,
        webAddressSet: install.webAddress !== null,
        webhookAddressSet: install.webhookAddress !== null,
        mcpWriteAllowed: getMcpWriteAllowed(db),
        debugLog: input.debug,
      }),
    },
    {
      name: "runners.json",
      text: json(
        runners.map((runner) => ({
          id: runner.id,
          kind: runner.kind,
          name: runner.name,
          sshTarget: runner.sshTarget,
          capacity: runner.capacity,
          online: runner.online,
          assignmentBlocked: runner.assignmentBlocked,
          checkedAt: runner.checkedAt,
          offlineSince: runner.offlineSince,
          checkError: runner.checkError,
          prerequisites: (runner.prerequisites ?? []).map((prerequisite) => ({
            id: prerequisite.id,
            satisfied: prerequisite.satisfied,
            blocksAssignment: prerequisite.blocksAssignment,
          })),
        })),
      ),
    },
    {
      name: "runs.json",
      text: json(
        runs.map((run) => ({
          id: run.id,
          ticketKey: run.ticket.key,
          state: run.state,
          runnerId: run.runnerId,
          agent: run.agent,
          model: run.model,
          worktreeName: run.worktreeName,
          assignedAt: run.assignedAt,
          startedAt: run.state === "queued" ? null : run.startedAt,
          endedAt: run.state === "ended" ? run.endedAt : null,
          agentResult: run.state === "ended" ? run.agentResult : null,
          prState: run.state === "ended" ? run.prState : null,
        })),
      ),
    },
    { name: "webhooks.json", text: json(webhooks) },
    { name: "process-report.json", text: json(reportSummary(system.report())) },
    {
      name: "server-logs.jsonl",
      text: logs.map((line) => finish(`${JSON.stringify(line)}\n`)).join(""),
    },
  ];
  if (timeline !== null) files.push({ name: "run-timeline.json", text: json(timeline) });
  const name = `ganger-diagnostics-${stamp(now)}-${randomBytes(3).toString("hex")}.zip`;
  return { name, files, zip: writeZip(files, now) };
}

export function redactDeep(value: unknown): unknown {
  if (typeof value === "string") return scrubText(value);
  if (value instanceof Date) return value.toISOString();
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactDeep);
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [
      key,
      isSecretKey(key) ? REDACTED : redactDeep(inner),
    ]),
  );
}

export function bundleLogLines(logDir: string, now: Date): StoredLogLine[] {
  const warnings = readServerLogs(logDir, {
    level: "warn",
    since: new Date(now.getTime() - WARN_LOG_DAYS * DAY_MS),
  });
  const info = readServerLogs(logDir, {
    level: "info",
    since: new Date(now.getTime() - WARN_LOG_DAYS * DAY_MS),
  })
    .filter((line) => line.level === "info")
    .slice(-RECENT_INFO_LINES);
  return [...warnings, ...info]
    .sort((a, b) => Date.parse(a.t) - Date.parse(b.t))
    .map(redactStoredLine);
}

function processLife(lines: ReadonlyArray<StoredLogLine>) {
  const last = new Map<string, { event: string; at: string; pid: number }>();
  for (const line of lines) {
    if (LIFE_EVENTS.has(line.event))
      last.set(line.proc, { event: line.event, at: line.t, pid: line.pid });
  }
  return Object.fromEntries(last);
}

function fileSize(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

function databaseSummary(db: Database, path: string | null) {
  const schema = checkSchema(db);
  return {
    sizeBytes: path === null ? null : fileSize(path),
    walBytes: path === null ? null : fileSize(`${path}-wal`),
    schema: schema.kind,
    migrations: schema.kind === "current" ? [] : schemaNames(schema),
  };
}

function schemaNames(schema: ReturnType<typeof checkSchema>): string[] {
  switch (schema.kind) {
    case "current":
      return [];
    case "behind":
      return schema.missing;
    case "ahead":
      return schema.unknown;
    case "edited":
      return schema.changed;
  }
}

export function folderSummary(dir: string): {
  totalBytes: number;
  files: Array<{ name: string; bytes: number }>;
} {
  if (!existsSync(dir)) return { totalBytes: 0, files: [] };
  const files: Array<{ name: string; bytes: number }> = [];
  const walk = (folder: string, prefix: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path, `${prefix}${entry.name}/`);
      else if (entry.isFile())
        files.push({ name: `${prefix}${entry.name}`, bytes: fileSize(path) ?? 0 });
    }
  };
  walk(dir, "");
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { totalBytes: files.reduce((sum, file) => sum + file.bytes, 0), files };
}

const reportSchema = z
  .object({
    header: z
      .object({
        nodejsVersion: z.string().optional(),
        platform: z.string().optional(),
        arch: z.string().optional(),
        osName: z.string().optional(),
        osRelease: z.string().optional(),
        osMachine: z.string().optional(),
        cpus: z.array(z.unknown()).optional(),
        wordSize: z.number().optional(),
      })
      .optional(),
    javascriptHeap: z
      .object({ totalMemory: z.number().optional(), usedMemory: z.number().optional() })
      .optional(),
    resourceUsage: z
      .object({
        rss: z.number().optional(),
        userCpuSeconds: z.number().optional(),
        kernelCpuSeconds: z.number().optional(),
        maxRss: z.number().optional(),
      })
      .optional(),
    libuv: z.array(z.unknown()).optional(),
  })
  .catch({});

export function reportSummary(report: unknown) {
  const parsed = reportSchema.parse(report);
  return {
    node: parsed.header?.nodejsVersion ?? null,
    platform: parsed.header?.platform ?? null,
    arch: parsed.header?.arch ?? null,
    os: parsed.header?.osName ?? null,
    osRelease: parsed.header?.osRelease ?? null,
    machine: parsed.header?.osMachine ?? null,
    cpus: parsed.header?.cpus?.length ?? null,
    wordSize: parsed.header?.wordSize ?? null,
    heap: parsed.javascriptHeap ?? null,
    resourceUsage: parsed.resourceUsage ?? null,
    libuvHandles: parsed.libuv?.length ?? null,
  };
}

function stamp(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
}
