import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { colors, fontSize, lineHeight, motion, radius, size, space } from "../tokens.stylex";
import { focusStyles } from "./focus";
import { CheckIcon } from "./icons";
import { textStyles } from "./text";
import { VisuallyHidden } from "./visually-hidden";

export type StepState = "todo" | "current" | "done";

export interface StepNavProps {
  label: string;
  title: ReactNode;
  children: ReactNode;
}

export function StepNav({ label, title, children }: StepNavProps) {
  return (
    <nav aria-label={label} {...stylex.props(styles.nav)}>
      <span {...stylex.props(textStyles("panel"))}>{title}</span>
      <ol {...stylex.props(styles.list)}>{children}</ol>
    </nav>
  );
}

export interface StepNavItemProps {
  number: number;
  name: ReactNode;
  state: StepState;
  doneLabel: string;
  onSelect?: () => void;
}

export function StepNavItem({ number, name, state, doneLabel, onSelect }: StepNavItemProps) {
  const done = state === "done";
  const content = (
    <>
      <StepMarker state={state}>
        {done ? (
          <>
            <CheckIcon />
            <VisuallyHidden>{number}</VisuallyHidden>
          </>
        ) : (
          number
        )}
      </StepMarker>
      <span>{name}</span>
      {done ? <VisuallyHidden>{doneLabel}</VisuallyHidden> : null}
    </>
  );
  return (
    <li>
      {onSelect === undefined ? (
        <span
          {...(state === "current" ? { "aria-current": "step" as const } : {})}
          {...stylex.props(styles.step, state === "current" && styles.current)}
        >
          {content}
        </span>
      ) : (
        <button
          type="button"
          onClick={onSelect}
          {...stylex.props(styles.step, styles.button, focusStyles.ring, done && styles.done)}
        >
          {content}
        </button>
      )}
    </li>
  );
}

export type StepMarkerTone = StepState | "guide";

export function StepMarker({
  state,
  large,
  children,
}: {
  state: StepMarkerTone;
  large?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      {...(state === "guide" ? { "aria-hidden": true } : {})}
      {...stylex.props(styles.marker, markerTones[state], large === true && styles.large)}
    >
      {children}
    </span>
  );
}

export function DoneMark() {
  return (
    <StepMarker state="done" large>
      <CheckIcon />
    </StepMarker>
  );
}

export function NumberedList({ items }: { items: ReadonlyArray<ReactNode> }) {
  return (
    <ol {...stylex.props(styles.numbered)}>
      {items.map((content, i) => (
        <li key={i} {...stylex.props(styles.numberedItem)}>
          <StepMarker state="guide">{i + 1}</StepMarker>
          <span {...stylex.props(styles.numberedBody)}>{content}</span>
        </li>
      ))}
    </ol>
  );
}

export function BulletList({
  items,
  tone = "secondary",
}: {
  items: ReadonlyArray<ReactNode>;
  tone?: "secondary" | "tertiary";
}) {
  return (
    <ul {...stylex.props(styles.bullets, tone === "tertiary" && styles.bulletsTertiary)}>
      {items.map((content, i) => (
        <li key={i}>{content}</li>
      ))}
    </ul>
  );
}

export function CheckTick({
  done,
  running,
  label,
}: {
  done: boolean;
  running?: boolean;
  label: string;
}) {
  const busy = !done && running === true;
  return (
    <span
      role="img"
      aria-label={label}
      {...stylex.props(done ? styles.tick : styles.tickEmpty, busy && styles.tickRunning)}
    >
      {done ? <CheckIcon /> : null}
    </span>
  );
}

export function Checklist({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul aria-label={label} {...stylex.props(styles.checklist)}>
      {children}
    </ul>
  );
}

export function ChecklistItem({
  done,
  running,
  label,
  children,
}: {
  done: boolean;
  running?: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <li {...stylex.props(styles.checkItem)}>
      <CheckTick done={done} {...(running === undefined ? {} : { running })} label={label} />
      {children}
    </li>
  );
}

const spin = stylex.keyframes({ to: { transform: "rotate(360deg)" } });

const styles = stylex.create({
  nav: { display: "flex", flexDirection: "column", gap: space.s6 },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  step: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    width: "100%",
    paddingBlock: space.s2,
    paddingInline: space.s3,
    borderRadius: radius.control,
    color: colors.textTertiary,
    fontSize: fontSize.body,
    boxSizing: "border-box",
  },
  button: {
    borderWidth: 0,
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, "@media (hover: hover)": colors.bgHover },
    },
    font: "inherit",
    fontSize: fontSize.body,
    textAlign: "start",
    cursor: "pointer",
  },
  done: { color: colors.textSecondary },
  current: { backgroundColor: colors.bgCard, color: colors.textPrimary },
  marker: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: size.pill,
    height: size.pill,
    borderRadius: radius.full,
    fontSize: fontSize.label,
    fontVariantNumeric: "tabular-nums",
  },
  large: { width: size.markerLarge, height: size.markerLarge },
  numbered: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
  },
  numberedItem: { display: "flex", gap: space.s3, alignItems: "flex-start" },
  numberedBody: {
    flexGrow: 1,
    minWidth: 0,
    color: colors.textSecondary,
    lineHeight: lineHeight.relaxed,
  },
  bullets: {
    margin: 0,
    paddingBlock: 0,
    paddingInlineEnd: 0,
    paddingInlineStart: space.s5,
    listStyleType: "disc",
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    color: colors.textSecondary,
    lineHeight: lineHeight.relaxed,
  },
  bulletsTertiary: { color: colors.textTertiary },
  checklist: {
    margin: 0,
    paddingBlock: 0,
    paddingInlineStart: space.s10,
    paddingInlineEnd: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    color: colors.textPrimary,
  },
  checkItem: { display: "flex", alignItems: "center", gap: space.s2, flexWrap: "wrap" },
  tick: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: size.tick,
    height: size.tick,
    color: colors.accentText,
  },
  tickEmpty: {
    display: "inline-block",
    flexShrink: 0,
    width: size.icon,
    height: size.icon,
    boxSizing: "border-box",
    borderWidth: 2,
    borderStyle: "solid",
    borderColor: colors.borderStrong,
    borderRadius: radius.full,
  },
  tickRunning: {
    borderColor: colors.accent,
    borderTopColor: "transparent",
    animationName: { default: "none", "@media (prefers-reduced-motion: no-preference)": spin },
    animationDuration: motion.durationSpin,
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
});

const markerTones = stylex.create({
  todo: { backgroundColor: colors.bgControl, color: colors.textTertiary },
  current: { backgroundColor: colors.accent, color: colors.textOnAccent },
  done: { backgroundColor: colors.accentSoft, color: colors.accentText },
  guide: { backgroundColor: colors.accentSoft, color: colors.accentText },
});
