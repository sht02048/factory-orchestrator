import type { RunProgress } from "./adapters.js";
import type { AgentResult, RunState } from "./run.js";

/** 런 중 러너에 이 시간 동안 계속 닿지 않으면(1단계는 ssh 실패) Disconnected가 된다(Q50·Q67). */
export const DISCONNECT_AFTER_MS = 5 * 60 * 1000;

export interface TimeoutDecision {
  agentResult: Extract<
    AgentResult,
    "timed-out" | "stopped-waiting-for-input" | "runner-disconnected"
  >;
  /** 오케스트레이터가 에이전트를 멈춰야 하는지. Disconnected면 러너에 닿지 않아 멈출 수 없다. */
  stopAgent: boolean;
}

/**
 * 최대 실행 시간이 지났는지 보고, 지났으면 멈출 때의 상태로 에이전트 결과를 가른다
 * (Q39·Q52·Q67·Q70). 시계는 시작부터 흐르고 Waiting for Input·Disconnected 동안에도 멈추지 않는다.
 * 지나지 않았거나 Queued·Ended 런이면 null이다.
 */
export function decideTimeout(input: {
  state: RunState;
  startedAt: Date;
  now: Date;
  maxRunMs: number;
}): TimeoutDecision | null {
  if (input.now.getTime() - input.startedAt.getTime() < input.maxRunMs) return null;
  switch (input.state) {
    case "running":
      return { agentResult: "timed-out", stopAgent: true };
    case "waiting-for-input":
      return { agentResult: "stopped-waiting-for-input", stopAgent: true };
    case "disconnected":
      return { agentResult: "runner-disconnected", stopAgent: false };
    case "queued":
    case "ended":
      return null;
  }
}

/**
 * 연결 끊김 판단(Q50·Q67). Running·Waiting for Input 런의 러너에 5분 동안 계속 닿지 않았으면
 * Disconnected로 바꾼다. 5분 안이면 상태를 바꾸지 않고 이어서 본다.
 * `unreachableSince`는 연속으로 닿지 않기 시작한 시각이고, 한 번이라도 닿으면 null로 되돌린다.
 */
export function decideConnection(input: {
  state: RunState;
  unreachableSince: Date | null;
  now: Date;
}): "disconnect" | "keep-watching" {
  if (input.state !== "running" && input.state !== "waiting-for-input") return "keep-watching";
  if (input.unreachableSince === null) return "keep-watching";
  const failingMs = input.now.getTime() - input.unreachableSince.getTime();
  return failingMs >= DISCONNECT_AFTER_MS ? "disconnect" : "keep-watching";
}

export type ProgressResolution =
  | { kind: "continue"; state: "running" | "waiting-for-input" }
  | {
      kind: "end";
      agentResult: Extract<
        AgentResult,
        "exited-normally" | "exited-with-error" | "worktree-missing"
      >;
    };

/**
 * 러너에서 읽은 실제 상태로 다음 상태나 에이전트 결과를 정한다. 평소 폴링과 Disconnected에서
 * 다시 연결했을 때(Q67) 함께 쓴다.
 * - 에이전트가 돌고 있음 → Running
 * - 입력을 기다리고 있음 → Waiting for Input (Disconnected에서도 바로 간다)
 * - 끝남 → 종료 코드 0이면 정상 종료, 그 밖은 오류 종료. 종료 코드를 읽지 못했으면(null)
 *   정상 종료라는 증거가 없으니 오류 종료로 둔다.
 * - 워크트리 사라짐 → 워크트리 없음(Q49)
 * 상태를 실제로 바꿀 때는 transitionRun을 거친다.
 */
export function resolveRunProgress(progress: RunProgress): ProgressResolution {
  switch (progress.kind) {
    case "running":
      return { kind: "continue", state: "running" };
    case "waiting-for-input":
      return { kind: "continue", state: "waiting-for-input" };
    case "finished":
      return {
        kind: "end",
        agentResult: progress.exitCode === 0 ? "exited-normally" : "exited-with-error",
      };
    case "gone":
      return { kind: "end", agentResult: "worktree-missing" };
  }
}

export interface RunDurations {
  /** 할당(Queued 포함)부터 런 종료까지. 끝나지 않았으면 null */
  leadTimeMs: number | null;
  /** 할당부터 시작까지. 시작하지 않았으면 now까지, now가 없으면 null */
  waitMs: number | null;
  /** 시작부터 종료까지. 끝나지 않았으면 now까지, 시작하지 않았거나 now가 없으면 null */
  executionMs: number | null;
}

/** 리드 타임과 그것을 나눈 대기 시간·실행 시간(Q59). */
export function runDurations(input: {
  assignedAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  now?: Date;
}): RunDurations {
  const { assignedAt, startedAt, endedAt, now } = input;
  const between = (from: Date, to: Date | null | undefined): number | null =>
    to === null || to === undefined ? null : to.getTime() - from.getTime();

  return {
    leadTimeMs: between(assignedAt, endedAt),
    waitMs: between(assignedAt, startedAt ?? now),
    executionMs: startedAt === null ? null : between(startedAt, endedAt ?? now),
  };
}
