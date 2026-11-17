import * as stylex from "@stylexjs/stylex";
import {
  Select as SdkSelect,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectTrigger,
  SelectValue,
} from "@ui-sdk/react/select";
import { cx } from "../cx";
import { colors, space } from "../tokens.stylex";
import { fieldStyles } from "./field";
import { CheckIcon, ChevronDownIcon } from "./icons";
import { popupStyles } from "./popup-styles";

/*
 * 폼 안에서 값 하나를 고른다. Field 안에 두면 Field 의 라벨이 이름이 된다.
 *
 * <Field label="에이전트">
 *   <Select value={agent} onValueChange={setAgent} options={[{ value: "claude", label: "Claude Code" }]} />
 * </Field>
 */

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  options: ReadonlyArray<SelectOption>;
  value: string | null;
  onValueChange: (value: string) => void;
  /** 아무것도 고르지 않았을 때 보일 글. */
  placeholder?: string;
  name?: string;
  disabled?: boolean;
}

export function Select({
  options,
  value,
  onValueChange,
  placeholder,
  name,
  disabled,
}: SelectProps) {
  return (
    <SdkSelect<string>
      items={options.map((o) => ({ value: o.value, label: o.label }))}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
      {...(placeholder === undefined ? {} : { placeholder })}
      {...(name === undefined ? {} : { name })}
      {...(disabled === undefined ? {} : { disabled })}
    >
      <SelectTrigger
        className={(s) =>
          cx(fieldStyles.control, styles.trigger, s.placeholder && styles.placeholder)
        }
      >
        <SelectValue className={cx(styles.value)} />
        <span {...stylex.props(styles.chevron)}>
          <ChevronDownIcon />
        </span>
      </SelectTrigger>
      <SelectContent sideOffset={4} className={cx(popupStyles.content)}>
        {options.map((o) => (
          <SelectItem
            key={o.value}
            value={o.value}
            className={(s) =>
              cx(
                popupStyles.item,
                s.highlighted && popupStyles.highlighted,
                s.selected && popupStyles.selected,
              )
            }
          >
            {o.label}
            <SelectItemIndicator className={cx(popupStyles.indicator)}>
              <CheckIcon />
            </SelectItemIndicator>
          </SelectItem>
        ))}
      </SelectContent>
    </SdkSelect>
  );
}

const styles = stylex.create({
  trigger: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    textAlign: "start",
    cursor: "pointer",
  },
  placeholder: { color: colors.textDisabled },
  value: {
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  chevron: {
    display: "inline-flex",
    flexShrink: 0,
    marginInlineStart: "auto",
    color: colors.textTertiary,
  },
});
