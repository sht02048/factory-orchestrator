import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { colors, fontSize, fontWeight, radius, size, space } from "../tokens.stylex";

/*
 * 상태 알약: 점 + 이름(ADR 0010 4번). 화면의 모든 상태를 이 컴포넌트 하나로 그린다.
 * 화면은 상태 값만 넘기고 색은 이 컴포넌트가 고른다(ADR 0010 5번). 이름은 메시지 파일에서 온
 * GLOSSARY 영어 용어를 children 으로 받는다(ADR 0005).
 */

/** 런 상태 */
export type RunStateStatus = "queued" | "running" | "waiting-for-input" | "disconnected";
/** 요약 결과 */
export type SummaryStatus = "merged" | "human-check" | "failed" | "canceled";
/** 러너 상태 */
export type RunnerStatus = "online" | "offline";
/** 손댈 일 종류. human-check·failed·disconnected 는 위와 같은 값이다 */
export type AttentionStatus =
  | "question"
  | "permission"
  | "human-check"
  | "failed"
  | "disconnected"
  | "runner-issue";

export type PillStatus = RunStateStatus | SummaryStatus | RunnerStatus | AttentionStatus;

/** 색 하나에 뜻 하나(ADR 0010 5번) */
export type StatusTone = "answer" | "check" | "problem" | "progress" | "merged" | "idle";

export const PILL_STATUSES = [
  "queued",
  "running",
  "waiting-for-input",
  "disconnected",
  "merged",
  "human-check",
  "failed",
  "canceled",
  "online",
  "offline",
  "question",
  "permission",
  "runner-issue",
] as const satisfies ReadonlyArray<PillStatus>;

/** 상태 값의 색. ADR 0010 5번의 표 그대로다 */
export function statusTone(status: PillStatus): StatusTone {
  switch (status) {
    case "question":
    case "permission":
    case "waiting-for-input":
      return "answer";
    case "human-check":
      return "check";
    case "failed":
    case "disconnected":
    case "runner-issue":
    case "offline":
      return "problem";
    case "running":
    case "online":
      return "progress";
    case "merged":
      return "merged";
    case "queued":
    case "canceled":
      return "idle";
  }
}

export interface StatusPillProps {
  status: PillStatus;
  /** 상태 이름. 메시지 파일의 GLOSSARY 영어 용어를 넘긴다. */
  children: ReactNode;
}

export function StatusPill({ status, children }: StatusPillProps) {
  const tone = statusTone(status);
  return (
    <span data-status={status} data-tone={tone} {...stylex.props(styles.pill, pillTone[tone])}>
      <span aria-hidden="true" {...stylex.props(styles.dot, dotTone[tone])} />
      {children}
    </span>
  );
}

const styles = stylex.create({
  pill: {
    display: "inline-flex",
    flexShrink: 0,
    alignItems: "center",
    gap: space.px6,
    height: size.pill,
    paddingInline: space.s2,
    borderRadius: radius.pill,
    fontSize: fontSize.small,
    fontWeight: fontWeight.medium,
    lineHeight: 1,
    whiteSpace: "nowrap",
  },
  dot: {
    flexShrink: 0,
    display: "inline-block",
    width: size.dot,
    height: size.dot,
    borderRadius: radius.full,
  },
});

const pillTone = stylex.create({
  answer: { backgroundColor: colors.answerSoft, color: colors.answer },
  check: { backgroundColor: colors.checkSoft, color: colors.check },
  problem: { backgroundColor: colors.problemSoft, color: colors.problem },
  progress: { backgroundColor: colors.progressSoft, color: colors.progress },
  merged: { backgroundColor: colors.mergedSoft, color: colors.merged },
  idle: { backgroundColor: colors.idleSoft, color: colors.idle },
});

const dotTone = stylex.create({
  answer: { backgroundColor: colors.answer },
  check: { backgroundColor: colors.check },
  problem: { backgroundColor: colors.problem },
  progress: { backgroundColor: colors.progress },
  merged: { backgroundColor: colors.merged },
  idle: { backgroundColor: colors.idle },
});
