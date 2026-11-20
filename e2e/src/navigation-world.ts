import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  toAgentId,
  toCodeHostKind,
  toLabelId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTicketKey,
  toTrackerStateId,
} from "@ganger/core";
import type { RunId } from "@ganger/core";
import {
  SecretBox,
  assignRun,
  migrate,
  openDatabase,
  recordRunnerCheck,
  saveAutoAssignLabel,
  saveCodeHostConnection,
  saveMapping,
  saveRunner,
  saveTrackerConnection,
  saveWorkspace,
  saveWorkspaceTrackerProject,
  toCodeHostConnectionId,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import type { Plugin, ViteDevServer } from "vite";
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { TRACKER_DELAY_ENV, TRACKER_DELAY_MS } from "./browser/slow-tracker-adapters.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const slowAdaptersModule = fileURLToPath(
  new URL("./browser/slow-tracker-adapters.ts", import.meta.url),
);

const runnerId = toRunnerId("runner-a");
const runnerProject = toRunnerProjectId("fake:acme/web");
const encryptionKey = new Uint8Array(32).fill(7);
export const watchedTicket = toTicketKey("ACME-7");

const slowAdapters: Plugin = {
  name: "e2e-slow-tracker-adapters",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (importer === undefined || !source.endsWith("/adapters")) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved?.id === adaptersModule ? slowAdaptersModule : null;
  },
};

export interface NavigationWorld {
  db: Database;
  web: ViteDevServer;
  baseUrl: string;
  watchedRun: RunId;
  close: () => Promise<void>;
}

export async function startNavigationWorld(
  trackerDelayMs: number = TRACKER_DELAY_MS,
): Promise<NavigationWorld> {
  const dir = mkdtempSync(join(tmpdir(), "ganger-navigation-"));
  const dbPath = join(dir, "ganger.db");
  const db = openDatabase(dbPath);
  migrate(db);
  const watchedRun = seed(db);
  process.env["DATABASE_PATH"] = dbPath;
  process.env["ENCRYPTION_KEY"] = Buffer.from(encryptionKey).toString("base64");
  process.env[TRACKER_DELAY_ENV] = String(trackerDelayMs);
  const { server: web, baseUrl } = await startWebServer({
    plugins: [slowAdapters],
    cacheDir: join(dir, "vite-cache"),
  });
  return {
    db,
    web,
    baseUrl,
    watchedRun,
    close: async () => {
      await web.close();
      db.$client.close();
      delete process.env["DATABASE_PATH"];
      delete process.env["ENCRYPTION_KEY"];
      delete process.env[TRACKER_DELAY_ENV];
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const navigationWorkspace = workspaceId;

function seed(database: Database): RunId {
  saveTrackerConnection(database, new SecretBox(encryptionKey), {
    id: connection,
    kind: fakeKind,
    name: "Acme",
    config: {},
    secrets: { apiKey: "secret" },
  });
  saveCodeHostConnection(database, new SecretBox(encryptionKey), {
    id: toCodeHostConnectionId("github"),
    kind: toCodeHostKind("github"),
    name: "github",
    config: {},
    secrets: { token: "github_pat_example" },
  });
  saveWorkspace(database, { id: workspaceId, name: "Acme" });
  saveWorkspaceTrackerProject(database, {
    workspaceId,
    connection,
    projectId: trackerProject,
    name: "Web",
    inProgressStateId: toTrackerStateId("in-progress"),
  });
  saveMapping(database, {
    connection,
    trackerProject,
    runnerProject,
    agent: toAgentId("claude"),
  });
  saveAutoAssignLabel(database, { workspaceId, connection, labelId: toLabelId("factory") });
  saveRunner(database, {
    id: runnerId,
    kind: toRunnerKind("fake"),
    name: "runner-a",
    config: {},
    capacity: 4,
  });
  recordRunnerCheck(database, {
    runnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects: [{ id: runnerProject, displayName: "acme/web", setupState: "ready" as const }],
    assignmentBlocked: false,
  });
  const assigned = assignRun(database, {
    ticket: { connection, key: watchedTicket },
    trackerProject,
    runnerProject,
    agent: toAgentId("claude"),
    runnerId,
  });
  if (!assigned.ok) throw new Error(assigned.reason);
  return assigned.run.id;
}
