import * as stylex from "@stylexjs/stylex";
import {
  Dialog as SdkDialog,
  DialogBackdrop,
  DialogClose as SdkDialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@ui-sdk/react/dialog";
import type { ReactNode } from "react";
import { cx } from "../cx";
import { windowRegion } from "../window-frame";
import { buttonStyles, type ButtonVariant } from "./button";
import {
  colors,
  fontSize,
  fontWeight,
  lineHeight,
  motion,
  radius,
  shadow,
  space,
} from "../tokens.stylex";

export interface DialogProps {
  trigger: ReactNode;
  triggerVariant?: ButtonVariant;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Dialog({
  trigger,
  triggerVariant = "secondary",
  title,
  description,
  children,
  actions,
  open,
  onOpenChange,
}: DialogProps) {
  return (
    <SdkDialog
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange === undefined
        ? {}
        : { onOpenChange: (next: boolean) => onOpenChange(next) })}
    >
      <DialogTrigger data-variant={triggerVariant} className={cx(...buttonStyles(triggerVariant))}>
        {trigger}
      </DialogTrigger>
      <DialogBackdrop {...windowRegion("no-drag")} className={cx(styles.backdrop)} />
      <DialogContent {...windowRegion("no-drag")} className={cx(styles.content)}>
        <div {...stylex.props(styles.head)}>
          <DialogTitle className={cx(styles.title)}>{title}</DialogTitle>
          {description === undefined ? null : (
            <DialogDescription className={cx(styles.description)}>{description}</DialogDescription>
          )}
        </div>
        {children}
        <div {...stylex.props(styles.actions)}>{actions}</div>
      </DialogContent>
    </SdkDialog>
  );
}

export interface DialogCloseProps {
  variant?: ButtonVariant;
  children: ReactNode;
  onClick?: () => void;
}

export function DialogClose({ variant = "secondary", children, onClick }: DialogCloseProps) {
  return (
    <SdkDialogClose
      {...(onClick === undefined ? {} : { onClick })}
      data-variant={variant}
      className={cx(...buttonStyles(variant))}
    >
      {children}
    </SdkDialogClose>
  );
}

const fadeIn = stylex.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });
const rise = stylex.keyframes({
  from: { opacity: 0, transform: "translate(-50%, -48%) scale(0.98)" },
  to: { opacity: 1, transform: "translate(-50%, -50%)" },
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
    top: "50%",
    left: "50%",
    zIndex: 201,
    display: "flex",
    flexDirection: "column",
    gap: space.s5,
    width: "min(440px, calc(100vw - 32px))",
    padding: space.s6,
    borderWidth: 0,
    borderRadius: radius.card,
    backgroundColor: colors.bgRaised,
    boxShadow: shadow.popover,
    color: colors.textPrimary,
    transform: "translate(-50%, -50%)",
    outline: "none",
    animationName: { default: rise, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: motion.durationFast,
    animationTimingFunction: motion.easeOut,
  },
  head: { display: "flex", flexDirection: "column", gap: space.s2 },
  title: {
    margin: 0,
    fontSize: fontSize.panel,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.snug,
  },
  description: {
    margin: 0,
    color: colors.textSecondary,
    fontSize: fontSize.body,
    lineHeight: lineHeight.relaxed,
    textWrap: "pretty",
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: space.s2,
  },
});
