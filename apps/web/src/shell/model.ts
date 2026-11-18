/*
 * 앱 셸이 보이는 값. server function 이 돌려주고 화면이 그린다. DB 를 들여오지 않는다.
 */

export interface WorkspaceSummary {
  id: string;
  name: string;
}

export interface ShellData {
  workspaces: WorkspaceSummary[];
  /** Runner Issue 인 러너 수. 레일의 Runners 아이콘 점에 보인다(ADR 0010 11번) */
  runnerIssues: number;
}

/**
 * 러너가 Runner Issue 인 까닭(ADR 0010 1번). 문제가 없으면 null 이다.
 * - offline: 러너에 닿지 않는다. 새 할당도 시작도 못 한다
 * - auth: GitHub 인증이 깨져 할당에서 뺐다(Q82.14·Q82.15). Online 은 그대로다
 * 둘 다면 offline 이다. 닿지 않으면 인증을 다시 확인할 수도 없다.
 */
export type RunnerIssueCause = "offline" | "auth";

export function runnerIssueCause(runner: {
  online: boolean;
  assignmentBlocked: boolean;
}): RunnerIssueCause | null {
  if (!runner.online) return "offline";
  if (runner.assignmentBlocked) return "auth";
  return null;
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
