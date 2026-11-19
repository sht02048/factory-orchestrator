import * as stylex from "@stylexjs/stylex";
import {
  Dialog as SdkDialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import type { ReactNode } from "react";
import { cx } from "../cx";
import { buttonStyles } from "./button";
import { textStyles } from "./text";
import { colors, fontSize, lineHeight, motion, shadow, size, space } from "../tokens.stylex";

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  closeLabel: string;
  initialFocus?: string;
  finalFocus?: () => HTMLElement | null;
  children: ReactNode;
}

export function Sheet({
  open,
  onOpenChange,
  status,
  title,
  subtitle,
  closeLabel,
  initialFocus,
  finalFocus,
  children,
}: SheetProps) {
  return (
    <SdkDialog open={open} onOpenChange={(next: boolean) => onOpenChange(next)}>
      <DialogBackdrop className={cx(styles.backdrop)} />
      <DialogContent
        {...(initialFocus === undefined ? {} : { initialFocus })}
        {...(finalFocus === undefined ? {} : { finalFocus })}
        className={cx(styles.content)}
      >
        <div {...stylex.props(styles.head)}>
          <div {...stylex.props(styles.status)}>{status}</div>
          <DialogClose data-variant="secondary" className={cx(...buttonStyles("secondary"))}>
            {closeLabel}
          </DialogClose>
        </div>
        <div {...stylex.props(styles.titleBlock)}>
          <DialogTitle className={cx(textStyles("panel"), styles.title)}>{title}</DialogTitle>
          {subtitle === undefined ? null : <p {...stylex.props(styles.subtitle)}>{subtitle}</p>}
        </div>
        {children}
      </DialogContent>
    </SdkDialog>
  );
}

const fadeIn = stylex.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });
const slideIn = stylex.keyframes({
  from: { opacity: 0, transform: "translateX(24px)" },
  to: { opacity: 1, transform: "none" },
});

const styles = stylex.create({
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 200,
    backgroundColor: colors.backdrop,
    animationName: { default: fadeIn, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: motion.durationFast,
    animationTimingFunction: motion.easeOut,
  },
  content: {
    position: "fixed",
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 201,
    display: "flex",
    flexDirection: "column",
    gap: space.s5,
    width: `min(${size.sheetWidth}, 100vw)`,
    overflowY: "auto",
    overscrollBehavior: "contain",
    padding: space.s6,
    borderWidth: 0,
    backgroundColor: colors.bgPanel,
    boxShadow: shadow.popover,
    color: colors.textPrimary,
    outline: "none",
    animationName: { default: slideIn, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: motion.durationFast,
    animationTimingFunction: motion.easeOut,
  },
  head: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
    minWidth: 0,
  },
  status: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.s2,
    minWidth: 0,
    color: colors.textTertiary,
    fontSize: fontSize.small,
    fontVariantNumeric: "tabular-nums",
  },
  titleBlock: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  title: { margin: 0, overflowWrap: "anywhere" },
  subtitle: {
    margin: 0,
    color: colors.textTertiary,
    fontSize: fontSize.small,
    lineHeight: lineHeight.relaxed,
  },
});
