import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, type ReactNode } from "react";
import { colors, fontSize, fontWeight, motion, radius, size, space } from "../tokens.stylex";

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
  changeMotion?: boolean;
  children: ReactNode;
}

const PILL_POP_KEYFRAMES: Keyframe[] = [
  { transform: "scale(1)", offset: 0 },
  { transform: "scale(1.06)", offset: 0.4 },
  { transform: "scale(1)", offset: 1 },
];

function cssVariableValue(token: unknown): string {
  const name = /var\((--[^,)]+)/.exec(String(token))?.[1];
  if (name === undefined) return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function usePillPop(status: PillStatus, enabled: boolean) {
  const pillRef = useRef<HTMLSpanElement>(null);
  const shownStatus = useRef(status);
  useEffect(() => {
    if (shownStatus.current === status) return;
    shownStatus.current = status;
    const pill = pillRef.current;
    if (
      !enabled ||
      pill === null ||
      typeof pill.animate !== "function" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    pill.animate(PILL_POP_KEYFRAMES, {
      duration: Number.parseFloat(cssVariableValue(motion.durationPillPop)) || 0,
      easing: cssVariableValue(motion.easeOut),
    });
  }, [status, enabled]);
  return pillRef;
}

export function StatusPill({ status, changeMotion = false, children }: StatusPillProps) {
  const tone = statusTone(status);
  const pillRef = usePillPop(status, changeMotion);
  return (
    <span
      ref={pillRef}
      data-status={status}
      data-tone={tone}
      {...stylex.props(styles.pill, pillTone[tone], changeMotion && styles.colorChange)}
    >
      <span
        aria-hidden="true"
        {...stylex.props(styles.dot, dotTone[tone], changeMotion && styles.colorChange)}
      />
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
  colorChange: {
    transitionProperty: "background-color, color",
    transitionDuration: motion.durationPillColor,
    transitionTimingFunction: motion.easeOut,
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
