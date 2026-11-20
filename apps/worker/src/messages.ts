import type { AgentResult, PrState, SummaryOutcome } from "@ganger/core";

export const messages = {
  resume: {
    message: "운영자가 멈춘 작업을 다시 시작했어요. 멈춘 데서 이어서 진행해 주세요.",
    restartPreamble:
      "이 워크트리에서 앞 에이전트가 하던 작업을 운영자가 멈췄어요. git 상태와 커밋 기록으로 어디까지 했는지 확인하고, 멈춘 데서 이어서 아래 티켓을 끝내 주세요.",
  },
  resultComment: {
    title: "Ganger 런이 끝났어요.",
    summary: "요약 결과",
    agentResult: "에이전트 결과",
    prState: "PR 상태",
    pr: "PR",
    noPr: "없음",
    runId: "런 ID",
  },
  summary: {
    merged: "Merged",
    "human-check": "Human Check",
    failed: "Failed",
    canceled: "취소",
  } satisfies Record<SummaryOutcome, string>,
  agentResult: {
    "reported-success": "완료 보고(성공)",
    "reported-failure": "완료 보고(실패)",
    "ended-without-report": "비정상 종료",
    "timed-out": "시간 초과",
    "stopped-waiting-for-input": "입력 기다리다 멈춤",
    "runner-disconnected": "러너 연결 끊김",
    "worktree-missing": "워크트리 없음",
    canceled: "운영자가 취소함",
    "could-not-start": "시작할 수 없음",
  } satisfies Record<AgentResult, string>,
  prState: {
    none: "없음",
    open: "열림",
    merged: "병합됨",
    closed: "닫힘",
  } satisfies Record<PrState, string>,
} as const;
