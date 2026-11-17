import {
  getRunWithRecords,
  getWorkspaceTrackerProject,
  listRunners,
  listRuns,
  listWorkspaces,
  toWorkspaceId,
} from "@factory/db";
import type { Database, StoredRun } from "@factory/db";
import { resolveWorkspace } from "../shell/model";
import { dailyThroughput, groupStats, statsPeriod, summarizeStats, utcDay } from "./model";
import type { StatsPage, StatsRun } from "./model";

/**
 * Stats 화면이 보일 값을 DB 에서 읽는다. 현재 Workspace(주소의 ws)에서 기간(오늘까지 14일, UTC) 안에
 * 끝난 런만 센다. 요약 결과와 시간은 저장하지 않으므로 core 함수로 계산한다(model.ts).
 */
export function loadStatsPage(db: Database, ws: string | undefined, now: Date): StatsPage {
  const workspace = resolveWorkspace(
    listWorkspaces(db).map((w) => ({ id: w.id, name: w.name })),
    ws,
  );
  if (workspace.kind !== "one") return { workspace };

  const period = statsPeriod(now);
  const runnerNames = new Map(listRunners(db).map((r) => [r.id, r.name]));
  const projectNames = new Map<string, string>();
  const projectName = (run: StoredRun): string => {
    const key = trackerProjectKey(run);
    let name = projectNames.get(key);
    if (name === undefined) {
      // Workspace 에서 뺀 트래커 프로젝트도 지난 런은 남는다. 이름을 모르면 ID 로 보인다.
      name =
        getWorkspaceTrackerProject(db, run.ticket.connection, run.trackerProject)?.name ??
        run.trackerProject;
      projectNames.set(key, name);
    }
    return name;
  };

  const runs = listRuns(db, {
    workspaceId: toWorkspaceId(workspace.workspace.id),
    states: ["ended"],
  }).flatMap((run): StatsRun[] => {
    if (run.state !== "ended") return [];
    // 기간 밖의 런은 빼서 날짜별 처리량의 합이 전체와 같게 한다.
    const day = utcDay(run.endedAt);
    if (day < period.firstDay || day > period.lastDay) return [];
    const later = getRunWithRecords(db, run.id)?.records.laterPrState ?? null;
    return [
      {
        // 러너를 정하지 않은 채 끝난 런(Queued에서 취소, 시작할 수 없음)은 러너 없음으로 묶는다.
        runner:
          run.runnerId === null
            ? { key: "", name: "—" }
            : { key: run.runnerId, name: runnerNames.get(run.runnerId) ?? run.runnerId },
        trackerProject: {
          key: trackerProjectKey(run),
          name: projectName(run),
        },
        agent: { key: run.agent, name: run.agent },
        agentResult: run.agentResult,
        prState: run.prState,
        runnerUnreached: run.runnerUnreached,
        laterPrState: later?.state ?? null,
        assignedAt: run.assignedAt,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
      },
    ];
  });

  return {
    workspace,
    period,
    total: summarizeStats(runs),
    daily: dailyThroughput(runs, period),
    groups: {
      runner: groupStats(runs, "runner"),
      trackerProject: groupStats(runs, "trackerProject"),
      agent: groupStats(runs, "agent"),
    },
  };
}

/**
 * 트래커 프로젝트 묶음 키. 트래커 프로젝트 ID 는 트래커 연결 안에서만 유일해 연결과 잇는다.
 * 고른 묶음으로 주소(sel)에 남으므로 주소에 안전한 글자만 쓴다.
 */
function trackerProjectKey(run: StoredRun): string {
  return `${encodeURIComponent(run.ticket.connection)}:${encodeURIComponent(run.trackerProject)}`;
}
