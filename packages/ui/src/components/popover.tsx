import * as stylex from "@stylexjs/stylex";
import {
  Popover as SdkPopover,
  PopoverClose,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@ui-sdk/react/popover";
import type { ReactNode, Ref } from "react";
import { cx } from "../cx";
import { buttonStyles, type ButtonVariant } from "./button";
import { CloseIcon } from "./icons";
import { popupStyles } from "./popup-styles";
import { colors, fontSize, fontWeight, lineHeight, radius, size, space } from "../tokens.stylex";

export interface PopoverProps {
  trigger: ReactNode;
  triggerVariant?: ButtonVariant;
  triggerRef?: Ref<HTMLButtonElement>;
  title: ReactNode;
  closeLabel: string;
  initialFocus?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function Popover({
  trigger,
  triggerVariant = "secondary",
  triggerRef,
  title,
  closeLabel,
  initialFocus,
  open,
  onOpenChange,
  children,
}: PopoverProps) {
  return (
    <SdkPopover open={open} onOpenChange={(next: boolean) => onOpenChange(next)}>
      <PopoverTrigger
        {...(triggerRef === undefined ? {} : { ref: triggerRef })}
        data-variant={triggerVariant}
        className={cx(...buttonStyles(triggerVariant))}
      >
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={6}
        collisionPadding={16}
        {...(initialFocus === undefined ? {} : { initialFocus })}
        className={cx(popupStyles.content, styles.content)}
      >
        <div {...stylex.props(styles.head)}>
          <PopoverTitle className={cx(styles.title)}>{title}</PopoverTitle>
          <PopoverClose aria-label={closeLabel} className={cx(styles.close)}>
            <CloseIcon />
          </PopoverClose>
        </div>
        {children}
      </PopoverContent>
    </SdkPopover>
  );
}

const styles = stylex.create({
  content: {
    gap: space.s3,
    width: "min(420px, calc(100vw - 32px))",
    minWidth: 0,
    maxHeight: "var(--available-height, 480px)",
    padding: space.s4,
    borderRadius: radius.card,
    color: colors.textPrimary,
    fontSize: fontSize.body,
  },
  head: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.s2,
    minWidth: 0,
  },
  title: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.s2,
    flexGrow: 1,
    minWidth: 0,
    margin: 0,
    color: colors.textSecondary,
    fontSize: fontSize.ui,
    fontWeight: fontWeight.regular,
    lineHeight: lineHeight.snug,
  },
  close: {
    display: "inline-grid",
    placeItems: "center",
    flexShrink: 0,
    width: size.control,
    height: size.control,
    marginBlock: `calc(${space.s1} * -1)`,
    padding: 0,
    borderWidth: 0,
    borderRadius: radius.control,
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, "@media (hover: hover)": colors.bgHover },
    },
    color: colors.textSecondary,
    cursor: "pointer",
    outline: { default: null, ":focus-visible": `2px solid ${colors.accentText}` },
  },
});
