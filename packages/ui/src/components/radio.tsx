import * as stylex from "@stylexjs/stylex";
import type { KeyboardEventHandler, ReactNode } from "react";
import { colors, lineHeight, radius, space } from "../tokens.stylex";

export function RadioGroup({ labelledBy, children }: { labelledBy?: string; children: ReactNode }) {
  return (
    <div
      {...(labelledBy === undefined ? {} : { role: "radiogroup", "aria-labelledby": labelledBy })}
      {...stylex.props(styles.group)}
    >
      {children}
    </div>
  );
}

export interface RadioOptionProps {
  name: string;
  value: string;
  checked: boolean;
  onCheck: () => void;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  children: ReactNode;
}

export function RadioOption({
  name,
  value,
  checked,
  onCheck,
  onKeyDown,
  children,
}: RadioOptionProps) {
  return (
    <label {...stylex.props(styles.option)}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onCheck}
        {...(onKeyDown === undefined ? {} : { onKeyDown })}
        {...stylex.props(styles.radio)}
      />
      <span {...stylex.props(styles.text)}>{children}</span>
    </label>
  );
}

const styles = stylex.create({
  group: { display: "flex", flexDirection: "column", gap: space.px2 },
  option: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.s2,
    minWidth: 0,
    paddingBlock: space.s2,
    paddingInline: space.s2,
    borderRadius: radius.control,
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, "@media (hover: hover)": colors.bgHover },
      ":has(input:checked)": colors.bgSelected,
    },
    color: colors.textPrimary,
    cursor: "pointer",
  },
  radio: {
    flexShrink: 0,
    width: 16,
    height: 16,
    marginBlock: 2,
    marginInline: 0,
    accentColor: colors.accent,
  },
  text: {
    minWidth: 0,
    lineHeight: lineHeight.normal,
    whiteSpace: "normal",
    overflowWrap: "anywhere",
  },
});
