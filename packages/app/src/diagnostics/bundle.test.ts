import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import {
  toAgentId,
  toDeliveryId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTicketKey,
  toTrackerConnectionId,
  toTrackerKind,
  toTrackerProjectId,
} from "@ganger/core";
import type { RunId } from "@ganger/core";
import {
  SecretBox,
  assignRun,
  migrate,
  openDatabase,
  recordTrackerEvent,
  saveInstallAddresses,
  saveMapping,
  saveRunner,
  saveTrackerConnection,
  saveWorkspace,
  saveWorkspaceTrackerProject,
  toWorkspaceId,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createAnonymizer } from "./anonymize.js";
import { buildDiagnostics } from "./bundle.js";
import type { DiagnosticsInput } from "./bundle.js";

const eventLine = z.object({ event: z.string() });
const NOW = new Date("2026-11-20T09:30:00.000Z");
const USER_HOME = "/Users/alice";
const GANGER_HOME_DIR = ".ganger";
const SSH_TARGET = "alice@studio-mac.tail1234.ts.net";
const RUNNER_NAME = "studio-mac";
const SERVER_HOST = "ganger.tail1234.ts.net";
const THIS_HOST = "alice-macbook";
const TICKET = "ACME-42";

const SECRETS = [
  "lin_api_0123456789abcdefABCDEF",
  "Bearer abcdefghijklmnop1234",
  "ghp_0123456789abcdefghij0123",
  "github_pat_11ABCDEFG0123456789_abcdefghijk",
  "xoxb-1234567890-abcdefghij",
  "sk-abcdefghijklmnop0123456789",
  "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAAB3NzaC1yc2E\n-----END OPENSSH PRIVATE KEY-----",
];

function readZip(zip: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  for (let index = 0; index < count; index += 1) {
    const packedSize = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const localAt = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    const dataAt = localAt + 30 + zip.readUInt16LE(localAt + 26) + zip.readUInt16LE(localAt + 28);
    files.set(name, inflateRawSync(zip.subarray(dataAt, dataAt + packedSize)).toString("utf8"));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface World {
  db: Database;
  gangerHome: string;
  userHome: string;
  runId: RunId;
}

function world(): World {
  const root = mkdtempSync(join(tmpdir(), "ganger-diagnostics-"));
  dirs.push(root);
  const userHome = join(root, USER_HOME);
  const gangerHome = join(userHome, GANGER_HOME_DIR);
  const logs = join(gangerHome, "logs");
  mkdirSync(logs, { recursive: true });
  const db = openDatabase(":memory:");
  migrate(db);
  const connection = toTrackerConnectionId("conn-1");
  const trackerProject = toTrackerProjectId("tp-1");
  const workspaceId = toWorkspaceId("ws-1");
  const repo = toRunnerProjectId("github:acme/web");
  const agent = toAgentId("claude");
  saveTrackerConnection(db, new SecretBox(new Uint8Array(32).fill(7)), {
    id: connection,
    kind: toTrackerKind("fake"),
    name: "Acme",
    config: {},
    secrets: { apiKey: SECRETS[0], webhookSecret: "whsec-plain-value-123" },
  });
  saveWorkspace(db, { id: workspaceId, name: "Acme" });
  saveWorkspaceTrackerProject(db, {
    workspaceId,
    connection,
    projectId: trackerProject,
    name: "Web",
    inProgressStateId: null,
  });
  saveMapping(db, { connection, trackerProject, runnerProject: repo, agent });
  saveRunner(db, {
    id: toRunnerId("runner-a"),
    kind: toRunnerKind("orca"),
    name: RUNNER_NAME,
    config: { sshTarget: SSH_TARGET, orcaPath: `${userHome}/bin/orca`, token: SECRETS[2] },
    capacity: 2,
  });
  saveInstallAddresses(
    db,
    { webAddress: `https://${SERVER_HOST}`, webhookAddress: `https://${SERVER_HOST}/hooks` },
    NOW,
  );
  recordTrackerEvent(db, connection, {
    deliveryId: toDeliveryId("delivery-1"),
    kind: "ticket.updated",
    ticketKey: toTicketKey(TICKET),
    projectId: trackerProject,
    labelIds: null,
    previousLabelIds: null,
    receivedAt: new Date(NOW.getTime() - 60_000),
  });
  const assigned = assignRun(db, {
    ticket: { connection, key: toTicketKey(TICKET) },
    trackerProject,
    runnerProject: repo,
    agent,
    now: new Date(NOW.getTime() - 30_000),
  });
  if (!assigned.ok) throw new Error(assigned.reason);
  const line = (minutesAgo: number, level: string, event: string, extra: object) =>
    `${JSON.stringify({
      t: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
      level,
      proc: "worker",
      pid: 41,
      v: "0.1.0",
      event,
      msg: "message",
      ...extra,
    })}\n`;
  writeFileSync(
    join(logs, "worker.jsonl"),
    [
      line(10, "info", "process.started", {}),
      line(9, "warn", "runner.check_failed", {
        runnerId: "runner-a",
        reason: `ssh ${SSH_TARGET} failed with ${SECRETS.join(" ")}`,
        err: { name: "Error", message: `open ${userHome}/.ssh/id_ed25519`, stack: SECRETS[1] },
      }),
      line(8.5, "warn", "tracker_event.process_failed", { ticketKey: "OPS-9" }),
      line(8, "info", "run.assigned", { ticketKey: TICKET, host: SERVER_HOST, origin: THIS_HOST }),
      line(7, "warn", "run.start_failed", { authorization: "Basic dXNlcjpwYXNzd29yZA==" }),
      line(60 * 24 * 8, "warn", "run.watch_failed", { reason: "eight days old" }),
    ].join(""),
  );
  writeFileSync(join(logs, "web.jsonl"), line(5, "error", "browser.error", { path: "/runs" }));
  return { db, gangerHome, userHome, runId: assigned.run.id };
}

function input(w: World, overrides: Partial<DiagnosticsInput> = {}): DiagnosticsInput {
  return {
    db: w.db,
    gangerHome: w.gangerHome,
    databasePath: null,
    system: {
      version: "0.1.0",
      node: "v24.0.0",
      platform: "darwin",
      release: "25.0.0",
      arch: "arm64",
      hostname: THIS_HOST,
      userHome: w.userHome,
      runMode: "launchd",
      report: () => ({
        header: { nodejsVersion: "v24.0.0", host: THIS_HOST, cpus: [{}, {}] },
        environmentVariables: { LINEAR_API_KEY: SECRETS[0], HOME: w.userHome },
      }),
    },
    debug: false,
    anonymize: true,
    runId: w.runId,
    now: NOW,
    ...overrides,
  };
}

function allText(files: Map<string, string>): string {
  return [...files.values()].join("\n");
}

describe("diagnostics bundle", () => {
  it("packs the summary, settings, runners, runs, webhooks, run timeline, logs and report into a zip with a short id", () => {
    const w = world();
    const bundle = buildDiagnostics(input(w));
    expect(bundle.name).toMatch(/^ganger-diagnostics-\d{8}-\d{4}-[0-9a-f]{6}\.zip$/);
    const files = readZip(bundle.zip);
    expect([...files.keys()].sort()).toEqual([
      "process-report.json",
      "run-timeline.json",
      "runners.json",
      "runs.json",
      "server-logs.jsonl",
      "settings.json",
      "summary.json",
      "webhooks.json",
    ]);
    const logEvents = (files.get("server-logs.jsonl") ?? "")
      .trim()
      .split("\n")
      .map((text) => eventLine.parse(JSON.parse(text)).event);
    expect(logEvents).toEqual([
      "process.started",
      "runner.check_failed",
      "tracker_event.process_failed",
      "run.assigned",
      "run.start_failed",
      "browser.error",
    ]);
    expect(JSON.parse(files.get("summary.json") ?? "")).toMatchObject({
      ganger: "0.1.0",
      runMode: "launchd",
      processes: { worker: { event: "process.started" } },
      database: { schema: "current" },
    });
    expect(JSON.parse(files.get("process-report.json") ?? "")).toMatchObject({ cpus: 2 });
  });

  it("leaves no secret from logs, settings, runner config or the process report", () => {
    const w = world();
    for (const anonymize of [true, false]) {
      const text = allText(readZip(buildDiagnostics(input(w, { anonymize })).zip));
      for (const secret of SECRETS) expect(text).not.toContain(secret.slice(0, 20));
      expect(text).not.toContain("whsec-plain-value-123");
      expect(text).not.toContain("dXNlcjpwYXNzd29yZA");
      expect(text).not.toContain("LINEAR_API_KEY");
    }
  });

  it("hides ssh targets, hosts, home paths and ticket prefixes when anonymizing and keeps them otherwise", () => {
    const w = world();
    const hidden = allText(readZip(buildDiagnostics(input(w, { anonymize: true })).zip));
    const shown = allText(readZip(buildDiagnostics(input(w, { anonymize: false })).zip));
    for (const value of [SSH_TARGET, SERVER_HOST, THIS_HOST, RUNNER_NAME, w.userHome, TICKET]) {
      expect(shown).toContain(value);
      expect(hidden).not.toContain(value);
    }
    expect(hidden).not.toContain("ACME");
    expect(shown).toContain("OPS-9");
    expect(hidden).not.toContain("OPS-9");
    expect(hidden).toContain("PROJ1-42");
    expect(hidden).toContain("ssh-target-1");
    expect(hidden).toContain("~/.ssh/id_ed25519");
  });

  it("gives the same value the same alias in every file of a bundle", () => {
    const w = world();
    const files = readZip(buildDiagnostics(input(w)).zip);
    const runners = files.get("runners.json") ?? "";
    const logs = files.get("server-logs.jsonl") ?? "";
    const runs = files.get("runs.json") ?? "";
    const webhooks = files.get("webhooks.json") ?? "";
    expect(runners).toContain('"sshTarget": "ssh-target-1"');
    expect(runners).toContain('"name": "runner-1"');
    expect(logs).toContain("ssh ssh-target-1 failed");
    expect(runs).toContain('"ticketKey": "PROJ1-42"');
    expect(webhooks).toContain('"ticketKey": "PROJ1-42"');
    expect(logs).toContain('"ticketKey":"PROJ1-42"');
    const serverAlias = /"host":"(host-\d+)"/.exec(logs)?.[1];
    expect(serverAlias).toBeDefined();
    expect(files.get("settings.json")).not.toContain(SERVER_HOST);
  });
});

describe("anonymizer", () => {
  it("keeps aliases stable across calls and leaves unrelated words alone", () => {
    const anonymizer = createAnonymizer({
      sshTargets: ["bob@build.example.com"],
      hosts: ["build.example.com"],
      runnerNames: ["mac"],
      ticketKeys: ["ENG-1", "OPS-7"],
      userHome: "/home/bob",
      gangerHome: "/srv/ganger",
    });
    expect(anonymizer.text("ssh bob@build.example.com")).toBe("ssh ssh-target-1");
    expect(anonymizer.text("host build.example.com, again build.example.com")).toBe(
      "host host-1, again host-1",
    );
    expect(anonymizer.text("mac runs macOS")).toBe("runner-1 runs macOS");
    expect(anonymizer.text("ENG-12 OPS-7 UTF-8 eng-12-fix ganger-ENG-12-1 ENG-123x")).toBe(
      "PROJ1-12 PROJ2-7 UTF-8 proj1-12-fix ganger-PROJ1-12-1 ENG-123x",
    );
    expect(anonymizer.text("/srv/ganger/logs and /home/bob/x and /Users/carol/y")).toBe(
      "<ganger-home>/logs and ~/x and ~/y",
    );
    expect(anonymizer.text("new box.tail9.ts.net then box.tail9.ts.net")).toBe(
      "new host-2 then host-2",
    );
  });
});
