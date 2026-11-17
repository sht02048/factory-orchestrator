/*
 * 앱 셸이 보이는 값. server function 이 돌려주고 화면이 그린다. DB 를 들여오지 않는다.
 */

export interface WorkspaceSummary {
  id: string;
  name: string;
}

/** 사이드바 RUNNERS 한 줄 */
export interface RunnerLoad {
  id: string;
  name: string;
  online: boolean;
  capacity: number;
  /** capacity 를 차지하는 런 수(Running, Waiting for Input, Disconnected). 모든 Workspace 를 센다 */
  occupied: number;
}

export interface ShellData {
  workspaces: WorkspaceSummary[];
  runners: RunnerLoad[];
}

/** 주소의 ws 값. 모든 Workspace 를 고르는 "전체" 보기(ADR 0006) */
export const ALL_WORKSPACES = "all";

export type WorkspaceChoice =
  | { kind: "none" }
  | { kind: "all" }
  | { kind: "one"; workspace: WorkspaceSummary };

/**
 * 주소의 ws 값으로 현재 Workspace 를 정한다. 값이 없거나 모르는 값이면 첫 Workspace 다.
 * Workspace 가 하나도 없으면 none 이다.
 */
export function resolveWorkspace(
  workspaces: ReadonlyArray<WorkspaceSummary>,
  ws: string | undefined,
): WorkspaceChoice {
  if (ws === ALL_WORKSPACES && workspaces.length > 0) return { kind: "all" };
  const found = workspaces.find((w) => w.id === ws) ?? workspaces[0];
  return found === undefined ? { kind: "none" } : { kind: "one", workspace: found };
}
