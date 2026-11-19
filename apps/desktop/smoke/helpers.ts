import { createServer } from "node:net";
import { homePaths, readBootEnv } from "@ganger/cli/home";
import {
  toAgentId,
  toAgentRef,
  toPermissionRequestId,
  toQuestionId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTicketKey,
  toTrackerConnectionId,
  toTrackerKind,
  toTrackerProjectId,
  toWorktreeRef,
} from "@ganger/core";
import type { AgentResult, PrState, RunId } from "@ganger/core";
import {
  SecretBox,
  assignRun,
  changeRunState,
  openDatabase,
  parseBootConfig,
  recordPermissionWaits,
  recordRunQuestions,
  recordRunnerCheck,
  saveMapping,
  saveRunner,
  saveTrackerConnection,
  saveWorkspace,
  saveWorkspaceTrackerProject,
  toWorkspaceId,
} from "@ganger/db";
import type { Database } from "@ganger/db";

export function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

export function nodeEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
  for (const name of [
    "WEB_HOST",
    "WEB_PORT",
    "DATABASE_PATH",
    "ENCRYPTION_KEY",
    "GANGER_HOME",
    "NODE_OPTIONS",
  ]) {
    delete env[name];
  }
  return env;
}

const connection = toTrackerConnectionId("conn-acme");
const trackerProject = toTrackerProjectId("tp-web");
const runnerProject = toRunnerProjectId("github:acme/web");
const runnerId = toRunnerId("runner-smoke");

function withDatabase<T>(home: string, run: (db: Database, key: Uint8Array) => T): T {
  const config = parseBootConfig(readBootEnv(homePaths(home).envFile, {}));
  const db = openDatabase(config.databasePath);
  try {
    db.$client.exec("PRAGMA busy_timeout = 5000");
    return run(db, config.encryptionKey);
  } finally {
    db.$client.close();
  }
}

function ensureBase(db: Database, key: Uint8Array): void {
  if (db.$client.prepare("SELECT 1 FROM runners WHERE id = ?").get(runnerId) !== undefined) return;
  const workspaceId = toWorkspaceId("ws-acme");
  saveTrackerConnection(db, new SecretBox(key), {
    id: connection,
    kind: toTrackerKind("fake"),
    name: "Acme",
    config: {},
    secrets: {},
  });
  saveWorkspace(db, { id: workspaceId, name: "Acme" });
  saveWorkspaceTrackerProject(db, {
    workspaceId,
    connection,
    projectId: trackerProject,
    name: "Web",
    inProgressStateId: null,
  });
  saveMapping(db, { connection, trackerProject, runnerProject, agent: toAgentId("claude") });
  saveRunner(db, {
    id: runnerId,
    kind: toRunnerKind("orca"),
    name: "smoke-runner",
    config: { sshTarget: "factory-smoke.invalid", connectTimeoutSeconds: 3 },
    capacity: 10,
  });
  recordRunnerCheck(db, {
    runnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    assignmentBlocked: false,
    projects: [{ id: runnerProject, displayName: "acme/web", setupState: "ready" }],
  });
}

function startRun(db: Database, key: string): RunId {
  const assigned = assignRun(db, {
    ticket: { connection, key: toTicketKey(key) },
    trackerProject,
    runnerProject,
    agent: toAgentId("claude"),
    now: new Date(),
  });
  if (!assigned.ok) throw new Error(assigned.reason);
  const worktree = `wt-${key.toLowerCase()}`;
  const started = changeRunState(db, assigned.run.id, {
    to: "running",
    started: {
      worktree: toWorktreeRef(worktree),
      branch: `acme/${worktree}`,
      agentRef: toAgentRef(`agent-${worktree}`),
    },
  });
  if (!started.ok) throw new Error(JSON.stringify(started));
  return assigned.run.id;
}

export function seedRunningRun(home: string, key = "ACME-1"): RunId {
  return withDatabase(home, (db, encryptionKey) => {
    ensureBase(db, encryptionKey);
    return startRun(db, key);
  });
}

export function seedNotificationCauses(home: string): void {
  withDatabase(home, (db, encryptionKey) => {
    ensureBase(db, encryptionKey);
    const waiting = (key: string): RunId => {
      const id = startRun(db, key);
      const changed = changeRunState(db, id, { to: "waiting-for-input" });
      if (!changed.ok) throw new Error(JSON.stringify(changed));
      return id;
    };
    recordRunQuestions(db, waiting("ACME-21"), [
      {
        id: toQuestionId("q-smoke"),
        body: "어느 쪽으로 할까요?",
        options: [],
        askedAt: new Date(),
      },
    ]);
    recordPermissionWaits(db, waiting("ACME-22"), [
      {
        id: toPermissionRequestId("apr-smoke"),
        detail: "Bash(touch notes.txt)",
        requestedAt: new Date(),
      },
    ]);
    const ended = (key: string, agentResult: AgentResult, prState: PrState): void => {
      const changed = changeRunState(db, startRun(db, key), { to: "ended", agentResult, prState });
      if (!changed.ok) throw new Error(JSON.stringify(changed));
    };
    ended("ACME-23", "reported-success", "open");
    ended("ACME-24", "reported-success", "merged");
    ended("ACME-25", "timed-out", "none");
  });
}
