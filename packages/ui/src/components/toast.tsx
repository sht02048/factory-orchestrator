import * as stylex from "@stylexjs/stylex";
import { Toast, ToastRegion, ToastTitle, toast } from "@ui-sdk/react/toast";
import { useEffect, useId, useState } from "react";
import type { ReactNode } from "react";
import { cx } from "../cx";
import {
  colors,
  fontSize,
  fontWeight,
  lineHeight,
  motion,
  radius,
  shadow,
  size,
  space,
} from "../tokens.stylex";

export function showToast(message: string): void {
  toast(message);
}

export interface ToasterProps {
  label: string;
  pinned?: ReactNode;
}

export function Toaster({ label, pinned }: ToasterProps) {
  const [pinnedSlot, setPinnedSlot] = useState<HTMLDivElement | null>(null);
  const pinnedHeight = useHeight(pinnedSlot);
  const region = stylex.props(styles.region, pinnedHeight > 0 && lifted.above(pinnedHeight));
  return (
    <>
      <ToastRegion aria-label={label} className={region.className ?? ""} style={region.style ?? {}}>
        {() => (
          <Toast
            className={(s) =>
              cx(styles.toast, s.front && styles.front, s.leaving && styles.leaving)
            }
          >
            <ToastTitle className={cx(styles.title)} />
          </Toast>
        )}
      </ToastRegion>
      {pinned === undefined ? null : (
        <div ref={setPinnedSlot} data-slot="pinned-toast" {...stylex.props(styles.pinnedSlot)}>
          {pinned}
        </div>
      )}
    </>
  );
}

function useHeight(element: HTMLElement | null): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (element === null) {
      setHeight(0);
      return;
    }
    const measure = () => setHeight(element.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return height;
}

export type PinnedToastTone = "accent" | "progress";

export interface PinnedToastProps {
  title: ReactNode;
  tone: PinnedToastTone;
  announcement: string;
  actions: ReactNode;
  children?: ReactNode;
}

export function PinnedToast({ title, tone, announcement, actions, children }: PinnedToastProps) {
  const titleId = useId();
  const [announced, setAnnounced] = useState("");
  useEffect(() => {
    setAnnounced(announcement);
  }, [announcement]);
  return (
    <section aria-labelledby={titleId} {...stylex.props(styles.pinned)}>
      <div {...stylex.props(styles.pinnedTitleRow)}>
        <span aria-hidden="true" {...stylex.props(styles.dot, dotTones[tone])} />
        <p id={titleId} {...stylex.props(styles.pinnedTitle)}>
          {title}
        </p>
      </div>
      {children === undefined ? null : <div {...stylex.props(styles.pinnedBody)}>{children}</div>}
      <div {...stylex.props(styles.pinnedActions)}>{actions}</div>
      <p role="status" {...stylex.props(styles.screenReaderOnly)}>
        {announced}
      </p>
    </section>
  );
}

const rise = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(6px)" },
  to: { opacity: 1, transform: "none" },
});

const styles = stylex.create({
  region: {
    position: "fixed",
    right: space.s6,
    bottom: space.s6,
    zIndex: 300,
    width: 320,
    height: "var(--toast-front-height, 0px)",
  },
  pinnedSlot: {
    position: "fixed",
    right: space.s6,
    bottom: space.s6,
    zIndex: 300,
    width: 320,
    maxWidth: `calc(100vw - 2 * ${space.s6})`,
  },
  pinned: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    paddingBlock: space.s4,
    paddingInline: space.s4,
    borderRadius: radius.card,
    backgroundColor: colors.bgRaised,
    boxShadow: shadow.popover,
    color: colors.textPrimary,
    fontSize: fontSize.ui,
    lineHeight: lineHeight.normal,
    animationName: { default: rise, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: motion.durationToast,
    animationTimingFunction: motion.easeOut,
  },
  pinnedTitleRow: { display: "flex", alignItems: "center", gap: space.s2 },
  pinnedTitle: { margin: 0, fontWeight: fontWeight.semibold },
  pinnedBody: { color: colors.textSecondary },
  pinnedActions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  dot: { flexShrink: 0, width: size.dot, height: size.dot, borderRadius: radius.full },
  screenReaderOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    margin: -1,
    padding: 0,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
  toast: {
    position: "absolute",
    insetInline: 0,
    bottom: 0,
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    paddingBlock: space.s2,
    paddingInline: space.s4,
    borderRadius: radius.control,
    backgroundColor: colors.bgRaised,
    boxShadow: shadow.popover,
    color: colors.textPrimary,
    fontSize: fontSize.ui,
    opacity: 0,
    animationName: { default: rise, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: motion.durationToast,
    animationTimingFunction: motion.easeOut,
    transitionProperty: "opacity, transform",
    transitionDuration: motion.durationToast,
    transitionTimingFunction: motion.easeOut,
    userSelect: "none",
  },
  front: { opacity: 1 },
  leaving: { opacity: 0, transform: "translateY(6px)" },
  title: { margin: 0 },
});

const dotTones = stylex.create({
  accent: { backgroundColor: colors.accent },
  progress: { backgroundColor: colors.progress },
});

const lifted = stylex.create({
  above: (height: number) => ({
    bottom: `calc(${space.s6} + ${space.s2} + ${height}px)`,
  }),
});
