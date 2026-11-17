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

/*
 * 화면 위에 띄우는 확인 창. 되돌릴 수 없는 행동(지우기, 연결 끊기)을 확인할 때만 쓴다.
 * 편집은 다이얼로그 대신 상세 패널이나 Settings 의 편집 영역에서 한다(ADR 0007).
 *
 * <Dialog
 *   trigger="지우기"
 *   title="Mapping 을 지울까요?"
 *   description="이 Mapping 으로 들어오던 티켓은 더 할당되지 않아요."
 *   actions={<><DialogClose>취소</DialogClose><DialogClose variant="primary" onClick={remove}>지우기</DialogClose></>}
 * />
 */

export interface DialogProps {
  /** 여는 버튼의 글. */
  trigger: ReactNode;
  triggerVariant?: ButtonVariant;
  title: ReactNode;
  description?: ReactNode;
  /** 본문(선택). 폼 칸 등. */
  children?: ReactNode;
  /** 맨 아래 버튼 줄. DialogClose 를 넣는다. 주 버튼을 마지막에 둔다. */
  actions: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Dialog({
  trigger,
  triggerVariant = "default",
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
      <DialogTrigger className={cx(...buttonStyles(triggerVariant))}>{trigger}</DialogTrigger>
      <DialogBackdrop className={cx(styles.backdrop)} />
      <DialogContent className={cx(styles.content)}>
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

/** 다이얼로그를 닫는 버튼. onClick 을 먼저 부른 뒤 닫는다. */
export function DialogClose({ variant = "default", children, onClick }: DialogCloseProps) {
  return (
    <SdkDialogClose
      {...(onClick === undefined ? {} : { onClick })}
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
    borderRadius: radius.md,
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
