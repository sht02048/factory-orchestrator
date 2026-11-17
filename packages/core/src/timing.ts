import type { CompletionReport, RunnerErrorDetail, RunProgress } from "./adapters.js";
import type { PermissionRequestId, QuestionId } from "./ids.js";
import type { AgentResult, RunState } from "./run.js";

/** 런 중 러너에 이 시간 동안 계속 닿지 않으면(1단계는 ssh 실패) Disconnected가 된다(Q50·Q67). */
export const DISCONNECT_AFTER_MS = 5 * 60 * 1000;

export interface TimeoutDecision {
  agentResult: Extract<
    AgentResult,
    "timed-out" | "stopped-waiting-for-input" | "runner-disconnected" | "canceled"
  >;
  /** 오케스트레이터가 에이전트를 멈춰야 하는지. Disconnected면 러너에 닿지 않아 멈출 수 없다. */
  stopAgent: boolean;
  /** 운영자가 취소함이 러너에 닿지 못한 채 끝났는지(Q82.21). 그 밖은 늘 거짓이다 */
  runnerUnreached: boolean;
}

/**
 * 최대 실행 시간이 지났는지 보고, 지났으면 멈출 때의 상태로 에이전트 결과를 가른다
 * (Q39·Q52·Q67·Q70). 시계는 시작부터 흐르고 Waiting for Input·Disconnected 동안에도 멈추지 않는다.
 * 지나지 않았거나 Queued·Ended 런이면 null이다.
 *
 * 처리되지 않은 취소 요청이 있으면(취소 중) 취소가 이긴다: 에이전트 결과는 운영자가 취소함이다.
 * Disconnected인 채 지났으면 러너에 닿지 못한 채 끝났다고 기록하고(Q82.21), 그 밖은 에이전트를 멈춘다.
 */
export function decideTimeout(input: {
  state: RunState;
  startedAt: Date;
  now: Date;
  maxRunMs: number;
  cancelRequested: boolean;
}): TimeoutDecision | null {
  if (input.now.getTime() - input.startedAt.getTime() < input.maxRunMs) return null;
  switch (input.state) {
    case "running":
    case "waiting-for-input":
      return {
        agentResult: input.cancelRequested
          ? "canceled"
          : input.state === "running"
            ? "timed-out"
            : "stopped-waiting-for-input",
        stopAgent: true,
        runnerUnreached: false,
      };
    case "disconnected":
      return input.cancelRequested
        ? { agentResult: "canceled", stopAgent: false, runnerUnreached: true }
        : { agentResult: "runner-disconnected", stopAgent: false, runnerUnreached: false };
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
  | { kind: "continue"; state: "running" }
  /**
   * 입력 기다림(Q82.3·Q82.4). 답하지 않은 질문과 처리하지 않은 권한 대기를 준다. 질문은 답하기 칸으로,
   * 권한 대기는 "러너 화면에서 허용해 주세요"와 거절로 보인다.
   */
  | {
      kind: "continue";
      state: "waiting-for-input";
      questions: ReadonlyArray<QuestionId>;
      permissionWaits: ReadonlyArray<PermissionRequestId>;
    }
  | {
      kind: "end";
      agentResult: Extract<
        AgentResult,
        "reported-success" | "reported-failure" | "ended-without-report" | "worktree-missing"
      >;
      /** 완료 보고로 끝났으면 그 보고. 에이전트를 닫아야 한다(Runner.closeAgent, Q82.19) */
      report: CompletionReport | null;
    };

/**
 * 러너에서 읽은 실제 상태로 다음 상태나 에이전트 결과를 정한다. 평소 폴링과 Disconnected에서
 * 다시 연결했을 때(Q67) 함께 쓴다.
 * - 완료 보고 → outcome이 성공이면 완료 보고(성공), 그 밖(실패, 모르는 값)은 완료 보고(실패)(Q82.2)
 * - 보고 없이 사라짐 → 비정상 종료(Q82.19)
 * - 워크트리 사라짐 → 워크트리 없음(Q49)
 * - 살아 있음 → 답하지 않은 질문이나 처리하지 않은 권한 대기가 있으면 Waiting for Input
 *   (Disconnected에서도 바로 간다), 없으면 Running. 러너는 메일을 소비하지 않고 읽으므로 답했는지·거절했는지는
 *   오케스트레이터 DB가 기준이다(Q82.5). `answered`에는 답을 보낸 질문을, `denied`에는 거절을 보낸
 *   권한 대기를 넣는다.
 * 상태를 실제로 바꿀 때는 transitionRun을 거친다.
 */
export function resolveRunProgress(
  progress: RunProgress,
  handled: {
    answered: ReadonlySet<QuestionId>;
    denied: ReadonlySet<PermissionRequestId>;
  },
): ProgressResolution {
  switch (progress.kind) {
    case "active": {
      const questions = progress.questions
        .map((q) => q.id)
        .filter((id) => !handled.answered.has(id));
      const permissionWaits = progress.permissionWaits
        .map((p) => p.id)
        .filter((id) => !handled.denied.has(id));
      if (questions.length === 0 && permissionWaits.length === 0) {
        return { kind: "continue", state: "running" };
      }
      return { kind: "continue", state: "waiting-for-input", questions, permissionWaits };
    }
    case "reported":
      return {
        kind: "end",
        agentResult:
          progress.report.outcome === "succeeded" ? "reported-success" : "reported-failure",
        report: progress.report,
      };
    case "ended-without-report":
      return { kind: "end", agentResult: "ended-without-report", report: null };
    case "worktree-gone":
      return { kind: "end", agentResult: "worktree-missing", report: null };
  }
}

/** 러너에는 닿는데 시작 명령이 오류를 낸 런을 같은 결정적 이름으로 다시 시도하는 횟수(Q86) */
export const MAX_START_RETRIES = 3;

/**
 * 시작 명령(Runner.startRun)이 실패했을 때 할 일(Q86).
 * - wait-like-offline: 러너에 닿지 못했거나 닿았어도 런을 돌릴 준비가 안 됐다(not-ready·not-installed). Offline 예외(Q72)처럼 러너를 비워 순서에서 빼 뒤 런을 막지 않고,
 *   맞는 러너가 생기면 원래 자리로 돌아간다. 다만 앞서 보낸 시작의 결과를 아직 모르는 런은 다른 러너에서
 *   다시 시작하면 에이전트가 둘 생길 수 있어, 러너를 비우지 않고 그 러너에서 확인할 때까지 순서에서만 뺀다.
 *   시도 횟수에 넣지 않는다.
 * - find-then-retry: 결과를 모른다(응답을 잃음). 다음에 같은 이름으로 findStartedRun을 불러 이미 시작했는지
 *   본 뒤에만 다시 보낸다. 시도 횟수에 넣지 않는다.
 * - recreate-mailbox: 우편함 터미널이 사라졌다. 다시 만든 뒤 다시 보낸다. 시도 횟수에 넣지 않는다.
 * - retry: 러너가 오류를 냈거나 읽을 수 없는 출력을 냈다. 같은 이름으로 다시 시도한다(다시 보내기 전에
 *   findStartedRun으로 이미 시작했는지 본다). `failures`는 이번 실패를 넣은 수다.
 * - could-not-start: 다시 시도를 MAX_START_RETRIES번 다 했는데도 오류다. 에이전트 결과 시작할 수 없음으로
 *   끝내고 오류 내용을 런에 남긴다.
 *
 * @param previousFailures 이 런에서 이미 센 오류 수
 */
export type StartFailureDecision =
  | { action: "wait-like-offline" | "find-then-retry" | "recreate-mailbox" }
  | { action: "retry" | "could-not-start"; failures: number };

export function decideStartFailure(
  error: RunnerErrorDetail,
  previousFailures: number,
): StartFailureDecision {
  switch (error.kind) {
    // 닿았지만 런타임이 꺼졌거나 도구가 없으면 러너 확인에서 Offline이 되는 상태라(RunnerHealth.online)
    // 닿지 않음과 같이 다룬다. 잠깐 재시작하는 동안 다시 시도 횟수를 써 버리지 않게 한다.
    case "unreachable":
    case "not-ready":
    case "not-installed":
      return { action: "wait-like-offline" };
    case "start-outcome-unknown":
      return { action: "find-then-retry" };
    case "mailbox-missing":
      return { action: "recreate-mailbox" };
    case "malformed-output":
    case "runner-error": {
      const failures = previousFailures + 1;
      return { action: failures > MAX_START_RETRIES ? "could-not-start" : "retry", failures };
    }
  }
}

export interface RunDurations {
  /** 할당(Queued 포함)부터 런 종료까지. 끝나지 않았으면 null */
  leadTimeMs: number | null;
  /**
   * 할당부터 시작까지. 시작하지 않고 끝났으면(Queued에서 취소, 시작할 수 없음) 할당부터 끝낸 시각까지다
   * (Q82.9·Q82.20). 시작하지 않았고 끝나지도 않았으면 now까지, now가 없으면 null
   */
  waitMs: number | null;
  /**
   * 시작부터 종료까지. 시작하지 않고 끝났으면 0이다(Q82.9·Q82.20). 끝나지 않았으면 now까지,
   * 시작하지 않았거나 now가 없으면 null
   */
  executionMs: number | null;
}

/** 리드 타임과 그것을 나눈 대기 시간·실행 시간(Q59·Q82.9·Q82.20). */
export function runDurations(input: {
  assignedAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  now?: Date;
}): RunDurations {
  const { assignedAt, startedAt, endedAt, now } = input;
  const between = (from: Date, to: Date | null | undefined): number | null =>
    to === null || to === undefined ? null : to.getTime() - from.getTime();

  if (startedAt === null && endedAt !== null) {
    const waited = between(assignedAt, endedAt);
    return { leadTimeMs: waited, waitMs: waited, executionMs: 0 };
  }
  return {
    leadTimeMs: between(assignedAt, endedAt),
    waitMs: between(assignedAt, startedAt ?? now),
    executionMs: startedAt === null ? null : between(startedAt, endedAt ?? now),
  };
}
