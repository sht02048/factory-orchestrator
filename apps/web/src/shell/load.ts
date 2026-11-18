import { listRunners, listWorkspaces } from "@factory/db";
import type { Database } from "@factory/db";
import type { ShellData } from "./model";
import { runnerIssueCause } from "./model";

/** 앱 셸(Workspace 바꾸기, Runners 점)이 보일 값을 DB 에서 읽는다. 러너는 Workspace 밖 자원이라 모두 센다(ADR 0006). */
export function loadShell(db: Database): ShellData {
  return {
    workspaces: listWorkspaces(db).map((w) => ({ id: w.id, name: w.name })),
    runnerIssues: listRunners(db).filter((runner) => runnerIssueCause(runner) !== null).length,
  };
}
