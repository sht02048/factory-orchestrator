export interface RunWorkspace {
  id: string;
  name: string;
}

export interface OccupyingRun {
  id: string;
  ticketKey: string;
  workspace: RunWorkspace;
  state: "running" | "waiting-for-input" | "disconnected";
  executionMs: number;
}

export interface QueuedRunView {
  id: string;
  ticketKey: string;
  workspace: RunWorkspace;
  waitMs: number;
}

export interface LeftWorktree {
  id: string;
  ticketKey: string;
  workspace: RunWorkspace;
  worktree: "keep-until-pr-settles" | "operator-decides";
}

export interface RunnerCheckItem {
  id: string;
  name: string;
  project: string | null;
  satisfied: boolean | null;
  blocksAssignment: boolean;
  hint: string | null;
}

export interface RunnerView {
  id: string;
  name: string;
  online: boolean;
  assignmentBlocked: boolean;
  checks: RunnerCheckItem[] | null;
  checked: { at: string; agoMs: number } | null;
  capacity: number;
  occupying: OccupyingRun[];
  queued: QueuedRunView[];
  leftWorktrees: LeftWorktree[];
  sshTarget: string | null;
}

export interface RunnersPage {
  runners: RunnerView[];
}
