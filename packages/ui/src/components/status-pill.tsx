import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { colors, fontSize, fontWeight, radius, size, space } from "../tokens.stylex";

export type RunStateStatus = "queued" | "running" | "waiting-for-input" | "paused" | "disconnected";
export type SummaryStatus = "succeeded" | "failed" | "canceled";
export type RunnerStatus = "online" | "offline";
export type AttentionStatus =
  | "question"
  | "permission"
  | "human-check"
  | "failed"
  | "disconnected"
  | "runner-issue";

export type PillStatus = RunStateStatus | SummaryStatus | RunnerStatus | AttentionStatus;

export type StatusTone = "answer" | "check" | "problem" | "progress" | "merged" | "idle";

export const PILL_STATUSES = [
  "queued",
  "running",
  "waiting-for-input",
  "paused",
  "disconnected",
  "succeeded",
  "failed",
  "canceled",
  "online",
  "offline",
  "question",
  "permission",
  "human-check",
  "runner-issue",
] as const satisfies ReadonlyArray<PillStatus>;

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
    case "succeeded":
      return "merged";
    case "queued":
    case "paused":
    case "canceled":
      return "idle";
  }
}

export interface StatusPillProps {
  status: PillStatus;
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
