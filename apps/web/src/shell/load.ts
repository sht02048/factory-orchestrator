import { CAPACITY_OCCUPYING_STATES } from "@factory/core";
import { listRunPlacements, listRunners, listWorkspaces } from "@factory/db";
import type { Database } from "@factory/db";
import type { ShellData } from "./model";

/** 앱 셸(Workspace 전환기, RUNNERS)이 보일 값을 DB 에서 읽는다. 러너는 Workspace 밖 자원이라 모두 보인다(ADR 0006). */
export function loadShell(db: Database): ShellData {
  const placements = listRunPlacements(db);
  return {
    workspaces: listWorkspaces(db).map((w) => ({ id: w.id, name: w.name })),
    runners: listRunners(db).map((runner) => ({
      id: runner.id,
      name: runner.name,
      online: runner.online,
      capacity: runner.capacity,
      occupied: placements.filter(
        (p) => p.runnerId === runner.id && CAPACITY_OCCUPYING_STATES.has(p.state),
      ).length,
    })),
  };
}
