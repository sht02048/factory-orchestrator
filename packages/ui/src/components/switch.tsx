import * as stylex from "@stylexjs/stylex";
import { Switch as SdkSwitch, SwitchThumb } from "@ui-sdk/react/switch";
import { cx } from "../cx";
import { colors, motion, radius, size, space } from "../tokens.stylex";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  disabled?: boolean;
  name?: string;
}

export function Switch({ checked, onCheckedChange, disabled, name, ...aria }: SwitchProps) {
  return (
    <SdkSwitch
      {...aria}
      checked={checked}
      onCheckedChange={(next) => onCheckedChange(next === true)}
      {...(disabled === undefined ? {} : { disabled })}
      {...(name === undefined ? {} : { name })}
      className={(s) => cx(styles.track, s.checked && styles.on, s.disabled && styles.disabled)}
    >
      <SwitchThumb
        className={(s) =>
          cx(
            styles.thumb,
            s.checked && styles.thumbOn,
            s.disabled && styles.thumbDisabled,
            s.checked && s.disabled && styles.thumbOnDisabled,
          )
        }
      />
    </SdkSwitch>
  );
}

const THUMB_INSET = `calc((${size.switchHeight} - ${size.switchThumb}) / 2)`;

const styles = stylex.create({
  track: {
    position: "relative",
    display: "inline-flex",
    flexShrink: 0,
    alignItems: "center",
    width: size.switchWidth,
    height: size.switchHeight,
    padding: 0,
    borderWidth: 0,
    borderRadius: radius.full,
    backgroundColor: colors.borderStrong,
    cursor: "pointer",
    transitionProperty: "background-color",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
    "::before": {
      content: "''",
      position: "absolute",
      insetBlock: `calc(-1 * ${space.s1})`,
      insetInline: `calc(-1 * ${space.s1})`,
    },
  },
  on: { backgroundColor: colors.accent },
  disabled: { backgroundColor: colors.bgControl, cursor: "not-allowed" },
  thumb: {
    position: "absolute",
    insetBlockStart: THUMB_INSET,
    insetInlineStart: THUMB_INSET,
    width: size.switchThumb,
    height: size.switchThumb,
    borderRadius: radius.full,
    backgroundColor: colors.textPrimary,
    transitionProperty: "transform",
    transitionDuration: {
      default: motion.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
  },
  thumbOn: {
    backgroundColor: colors.textOnAccent,
    transform: `translateX(calc(${size.switchWidth} - ${size.switchThumb} - 2 * ${THUMB_INSET}))`,
  },
  thumbDisabled: { backgroundColor: colors.textDisabled },
  thumbOnDisabled: { backgroundColor: colors.textDisabled },
});
