import * as stylex from "@stylexjs/stylex";
import { Toast, ToastRegion, ToastTitle, toast } from "@ui-sdk/react/toast";
import { cx } from "../cx";
import { colors, fontSize, motion, radius, shadow, space } from "../tokens.stylex";

export function showToast(message: string): void {
  toast(message);
}

export interface ToasterProps {
  label: string;
}

export function Toaster({ label }: ToasterProps) {
  return (
    <ToastRegion aria-label={label} className={cx(styles.region)}>
      {() => (
        <Toast
          className={(s) => cx(styles.toast, s.front && styles.front, s.leaving && styles.leaving)}
        >
          <ToastTitle className={cx(styles.title)} />
        </Toast>
      )}
    </ToastRegion>
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
