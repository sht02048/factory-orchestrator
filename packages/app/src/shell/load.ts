import { listRunners, listWorkspaces } from "@ganger/db";
import type { Database } from "@ganger/db";
import type { ShellData } from "./model.js";
import { runnerIssueCause } from "./model.js";

export function loadShell(db: Database): ShellData {
  return {
    workspaces: listWorkspaces(db).map((w) => ({ id: w.id, name: w.name })),
    runnerIssues: listRunners(db).filter((runner) => runnerIssueCause(runner) !== null).length,
  };
}
