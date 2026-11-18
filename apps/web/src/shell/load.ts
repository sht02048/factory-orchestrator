import { listRunners, listWorkspaces } from "@factory/db";
import type { Database } from "@factory/db";
import type { ShellData } from "./model";
import { runnerIssueCause } from "./model";

export function loadShell(db: Database): ShellData {
  return {
    workspaces: listWorkspaces(db).map((w) => ({ id: w.id, name: w.name })),
    runnerIssues: listRunners(db).filter((runner) => runnerIssueCause(runner) !== null).length,
  };
}
