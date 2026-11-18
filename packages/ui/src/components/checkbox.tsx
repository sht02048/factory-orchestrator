import * as stylex from "@stylexjs/stylex";
import { Checkbox as SdkCheckbox, CheckboxIndicator } from "@ui-sdk/react/checkbox";
import type { ReactNode } from "react";
import { cx } from "../cx";
import { colors, fontSize, motion, radius, size, space } from "../tokens.stylex";
import { CheckIcon } from "./icons";

export interface CheckboxProps {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
  value?: string;
}

export function Checkbox({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  name,
  value,
}: CheckboxProps) {
  return (
    <label {...stylex.props(styles.row, disabled === true && styles.rowDisabled)}>
      <SdkCheckbox
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next === true)}
        {...(disabled === undefined ? {} : { disabled })}
        {...(name === undefined ? {} : { name })}
        {...(value === undefined ? {} : { value })}
        className={(s) =>
          cx(styles.box, s.checked && styles.checked, s.disabled && styles.disabled)
        }
      >
        <CheckboxIndicator className={cx(styles.indicator)}>
          <CheckIcon />
        </CheckboxIndicator>
      </SdkCheckbox>
      <span {...stylex.props(styles.text)}>
        <span {...stylex.props(disabled === true ? styles.labelDisabled : styles.label)}>
          {label}
        </span>
        {description === undefined ? null : (
          <span {...stylex.props(styles.description)}>{description}</span>
        )}
      </span>
    </label>
  );
}

const styles = stylex.create({
  row: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    minHeight: size.rowMinHeight,
    paddingInline: space.s3,
    borderRadius: radius.control,
    cursor: "pointer",
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, "@media (hover: hover)": colors.bgCardHover },
    },
  },
  rowDisabled: {
    cursor: "not-allowed",
    backgroundColor: { default: "transparent", ":hover": "transparent" },
  },
  box: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 18,
    height: 18,
    padding: 0,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    backgroundColor: colors.bgInset,
    color: colors.textOnAccent,
    cursor: "inherit",
    transitionProperty: "background-color, border-color",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
  },
  checked: { borderColor: colors.accent, backgroundColor: colors.accent },
  disabled: {
    borderColor: colors.borderDefault,
    backgroundColor: colors.bgCard,
    color: colors.textDisabled,
  },
  indicator: { display: "inline-flex" },
  text: { display: "flex", flexDirection: "column", gap: space.px2, minWidth: 0 },
  label: { color: colors.textPrimary },
  labelDisabled: { color: colors.textDisabled },
  description: { color: colors.textTertiary, fontSize: fontSize.small },
});
