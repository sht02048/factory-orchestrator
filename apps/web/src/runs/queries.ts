import { queryOptions } from "@tanstack/react-query";
import type { RunConditions } from "@ganger/app/runs/conditions";
import { getRunDetail, getRunsPage } from "../server/functions";

export const runsListKey = ["runs", "list"] as const;

export function runDetailKey(runId: string) {
  return ["runs", "detail", runId] as const;
}

export interface RunsListParams extends RunConditions {
  ws: string | undefined;
  ended: number;
}

export function runsListQuery(params: RunsListParams, timeZone: string) {
  const { ws, ...rest } = params;
  return queryOptions({
    queryKey: [...runsListKey, { ws: ws ?? "", ...rest }, timeZone] as const,
    queryFn: () => getRunsPage({ data: ws === undefined ? rest : { ...rest, ws } }),
  });
}

export function runDetailQuery(runId: string) {
  return queryOptions({
    queryKey: runDetailKey(runId),
    queryFn: () => getRunDetail({ data: { runId } }),
  });
}
