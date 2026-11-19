import * as stylex from "@stylexjs/stylex";
import { Toast, ToastRegion, ToastTitle, toast } from "@ui-sdk/react/toast";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
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
  useKeepFocusClear(pinnedSlot);
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

export const PINNED_TOAST_SPACE = "--pinned-toast-space";

function useKeepFocusClear(slot: HTMLElement | null): void {
  useEffect(() => {
    if (slot === null) return;
    const root = document.documentElement;
    const reserve = () =>
      root.style.setProperty(PINNED_TOAST_SPACE, `${slot.getBoundingClientRect().height}px`);
    reserve();
    const observer = new ResizeObserver(reserve);
    observer.observe(slot);
    const onFocus = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || slot.contains(target)) return;
      const covered = slot.getBoundingClientRect();
      const focused = target.getBoundingClientRect();
      const overlapsSideways = focused.right > covered.left && focused.left < covered.right;
      const hiddenBy = focused.bottom - covered.top;
      if (!overlapsSideways || hiddenBy <= 0) return;
      scrollerOf(target)?.scrollBy({ top: hiddenBy + covered.height / 4 });
    };
    document.addEventListener("focusin", onFocus);
    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", onFocus);
      root.style.removeProperty(PINNED_TOAST_SPACE);
    };
  }, [slot]);
}

function scrollerOf(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      parent.scrollHeight > parent.clientHeight
    )
      return parent;
  }
  return null;
}

function useRestoreFocusOnClose(section: { current: HTMLElement | null }) {
  const returnTo = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const element = section.current;
    return () => {
      if (element === null || !element.contains(document.activeElement)) return;
      const target = returnTo.current;
      setTimeout(() => {
        if (target !== null && target.isConnected) {
          target.focus();
          return;
        }
        const main = document.querySelector("main");
        if (main === null) return;
        if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
        main.focus();
      }, 0);
    };
  }, [section]);
  return (from: EventTarget | null) => {
    if (from instanceof HTMLElement && section.current?.contains(from) === false) {
      returnTo.current = from;
    }
  };
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

export interface PinnedToastProps {
  title: ReactNode;
  announcement: string;
  actions: ReactNode;
  children?: ReactNode;
}

export function PinnedToast({ title, announcement, actions, children }: PinnedToastProps) {
  const titleId = useId();
  const section = useRef<HTMLElement>(null);
  const rememberFocusOrigin = useRestoreFocusOnClose(section);
  const [announced, setAnnounced] = useState("");
  useEffect(() => {
    setAnnounced(announcement);
  }, [announcement]);
  return (
    <section
      ref={section}
      aria-labelledby={titleId}
      onFocus={(event) => rememberFocusOrigin(event.relatedTarget)}
      {...stylex.props(styles.pinned)}
    >
      <div {...stylex.props(styles.pinnedTitleRow)}>
        <span aria-hidden="true" {...stylex.props(styles.dot)} />
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
    maxWidth: `calc(100vw - ${size.railWidth} - 2 * ${space.s6})`,
  },
  pinned: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    paddingBlock: space.s4,
    paddingInline: space.s4,
    borderRadius: radius.card,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "transparent",
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
  dot: {
    flexShrink: 0,
    width: size.dot,
    height: size.dot,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
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

const lifted = stylex.create({
  above: (height: number) => ({
    bottom: `calc(${space.s6} + ${space.s2} + ${height}px)`,
  }),
});
