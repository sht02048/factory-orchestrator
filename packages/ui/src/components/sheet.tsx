import * as stylex from "@stylexjs/stylex";
import {
  Dialog as SdkDialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import { useEffect, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { cx } from "../cx";
import { windowRegion } from "../window-frame";
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
  const headRef = useRef<HTMLDivElement>(null);
  useIgnoreRepeatPressWhileClosing(headRef);
  return (
    <SdkDialog open={open} modal={open} onOpenChange={(next: boolean) => onOpenChange(next)}>
      <DialogBackdrop {...windowRegion("no-drag")} className={cx(styles.backdrop)} />
      <DialogContent
        {...windowRegion("no-drag")}
        {...(initialFocus === undefined ? {} : { initialFocus })}
        {...(finalFocus === undefined ? {} : { finalFocus })}
        className={cx(styles.content)}
      >
        <div ref={headRef} {...stylex.props(styles.head)}>
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

type SheetPhase = "closed" | "open" | "closing";

function sheetPhaseOf(popup: Element | null): SheetPhase {
  if (popup === null) return "closed";
  return popup.hasAttribute("data-ending-style") ? "closing" : "open";
}

function useIgnoreRepeatPressWhileClosing(insideSheet: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    let phaseAtPreviousPress: SheetPhase = "closed";
    let phaseAtLatestPress: SheetPhase = "closed";
    const currentPhase = () =>
      sheetPhaseOf(insideSheet.current?.closest('[role="dialog"]') ?? null);
    const rememberPress = () => {
      phaseAtPreviousPress = phaseAtLatestPress;
      phaseAtLatestPress = currentPhase();
    };
    const ignoreRepeatPress = (event: MouseEvent) => {
      if (event.detail < 2 || phaseAtPreviousPress === "closed" || currentPhase() === "open") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("pointerdown", rememberPress, true);
    document.addEventListener("mousedown", ignoreRepeatPress, true);
    document.addEventListener("click", ignoreRepeatPress, true);
    return () => {
      window.removeEventListener("pointerdown", rememberPress, true);
      document.removeEventListener("mousedown", ignoreRepeatPress, true);
      document.removeEventListener("click", ignoreRepeatPress, true);
    };
  }, [insideSheet]);
}

const REDUCED = "@media (prefers-reduced-motion: reduce)";
const STARTING = ":is([data-starting-style])";
const ENDING = ":is([data-ending-style])";

const styles = stylex.create({
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 200,
    backgroundColor: colors.backdrop,
    pointerEvents: { default: null, [ENDING]: "none" },
    opacity: { default: 1, [STARTING]: 0, [ENDING]: 0 },
    transitionProperty: "opacity",
    transitionDuration: {
      default: motion.durationSheetOpen,
      [ENDING]: motion.durationSheetClose,
      [REDUCED]: motion.durationReducedFade,
    },
    transitionTimingFunction: { default: motion.easeSheet, [ENDING]: motion.easeOut },
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
    pointerEvents: { default: null, [ENDING]: "none" },
    opacity: {
      default: 1,
      [REDUCED]: { default: 1, [STARTING]: 0, [ENDING]: 0 },
    },
    transform: {
      default: "none",
      [STARTING]: "translateX(100%)",
      [ENDING]: "translateX(100%)",
      [REDUCED]: "none",
    },
    transitionProperty: "opacity, transform",
    transitionDuration: {
      default: motion.durationSheetOpen,
      [ENDING]: motion.durationSheetClose,
      [REDUCED]: motion.durationReducedFade,
    },
    transitionTimingFunction: { default: motion.easeSheet, [ENDING]: motion.easeOut },
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
