import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { colors, fontWeight, radius, size, space } from "../tokens.stylex";

/**
 * 상태 표시: 점 + 글. 티켓의 Badge 를 대신한다(ADR 0007: 카드·배지를 쓰지 않는다).
 *
 * - check: Human Check. 주황.
 * - failed: Failed. 빨강.
 * - running: 실행 중. 무채색.
 * - neutral: Merged, Queued 처럼 손댈 일이 아닌 상태. 무채색.
 */
export type StatusTone = "check" | "failed" | "running" | "neutral";

/** 점만 쓰는 곳(러너 Online·Offline, 행의 이유 줄)에서 쓰는 톤. */
export type DotTone = StatusTone | "online" | "offline";

export interface StatusProps {
  tone: StatusTone;
  /** 상태 이름. 메시지 파일에서 가져온 글을 넘긴다. */
  children: ReactNode;
  /** 점을 함께 보일지. 표의 상태 열처럼 글만 둘 때 false. */
  dot?: boolean;
}

export function Status({ tone, children, dot = true }: StatusProps) {
  return (
    <span {...stylex.props(styles.status, textTone[tone])}>
      {dot ? <Dot tone={tone} /> : null}
      {children}
    </span>
  );
}

export interface DotProps {
  tone: DotTone;
  /** 점만으로 뜻을 전할 때 스크린 리더용 이름. 옆에 글이 있으면 생략한다. */
  label?: string;
}

export function Dot({ tone, label }: DotProps) {
  return label === undefined ? (
    <span aria-hidden="true" {...stylex.props(styles.dot, dotTone[tone])} />
  ) : (
    <span role="img" aria-label={label} {...stylex.props(styles.dot, dotTone[tone])} />
  );
}

const styles = stylex.create({
  status: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.px6,
    fontWeight: fontWeight.medium,
  },
  dot: {
    flexShrink: 0,
    display: "inline-block",
    width: size.dot,
    height: size.dot,
    borderRadius: radius.full,
  },
});

const textTone = stylex.create({
  check: { color: colors.check },
  failed: { color: colors.failed },
  running: { color: colors.textSecondary },
  neutral: { color: colors.textSecondary },
});

const dotTone = stylex.create({
  check: { backgroundColor: colors.check },
  failed: { backgroundColor: colors.failed },
  running: { backgroundColor: colors.textSecondary },
  neutral: { backgroundColor: colors.textTertiary },
  online: {
    backgroundColor: colors.online,
    boxShadow: `0 0 0 3px ${colors.onlineRing}`,
  },
  offline: { backgroundColor: colors.failed },
});
