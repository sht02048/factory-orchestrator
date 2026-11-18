import * as stylex from "@stylexjs/stylex";
import { Field as SdkField, FieldDescription, FieldError, FieldLabel } from "@ui-sdk/react/field";
import { Input as SdkInput } from "@ui-sdk/react/input";
import { createContext, use, type ReactNode, type Ref } from "react";
import { cx } from "../cx";
import { colors, fonts, fontSize, fontWeight, motion, radius, size, space } from "../tokens.stylex";

/*
 * 폼 칸: 라벨, 입력, 도움말, 오류를 잇는다(id·for·aria-describedby 는 UI SDK Field 가 맡는다).
 *
 * <Field label="러너 이름" description="ssh 설정의 Host 이름이에요">
 *   <Input name="host" mono />
 * </Field>
 */

export interface FieldProps {
  label: ReactNode;
  /** 입력 아래 흐린 도움말. */
  description?: ReactNode;
  /** 오류 문구. 있으면 입력이 invalid 가 되고 빨간 글로 보인다. */
  error?: ReactNode;
  children: ReactNode;
}

const InvalidContext = createContext(false);

export function Field({ label, description, error, children }: FieldProps) {
  const invalid = error !== undefined && error !== null && error !== false && error !== "";
  return (
    <SdkField invalid={invalid} className={cx(styles.field)}>
      <FieldLabel className={cx(styles.label)}>{label}</FieldLabel>
      <InvalidContext value={invalid}>{children}</InvalidContext>
      {description === undefined ? null : (
        <FieldDescription className={cx(styles.description)}>{description}</FieldDescription>
      )}
      {invalid ? <FieldError className={cx(styles.error)}>{error}</FieldError> : null}
    </SdkField>
  );
}

interface InputBaseProps {
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  type?: "text" | "url" | "password" | "email" | "search";
  autoComplete?: string;
  inputMode?: "text" | "numeric" | "decimal" | "email" | "url" | "search";
  /** 경로·주소·키처럼 그대로 옮겨 쓸 값. 고정폭 글꼴로 보인다. */
  mono?: boolean;
  /** 폼을 연 뒤 입력칸으로 포커스를 옮길 때 쓴다. */
  ref?: Ref<HTMLInputElement>;
  [data: `data-${string}`]: string | boolean | undefined;
}

/**
 * 값을 쥐는 방식은 셋 중 하나다. value 를 주면 onValueChange 나 readOnly 가 함께 있어야 한다
 * (둘 다 없으면 입력이 잠기고 React 가 경고한다).
 */
export type InputProps = InputBaseProps &
  (
    | {
        value?: never;
        defaultValue?: string;
        onValueChange?: (value: string) => void;
        readOnly?: boolean;
      }
    | {
        value: string;
        onValueChange: (value: string) => void;
        readOnly?: boolean;
        defaultValue?: never;
      }
    | { value: string; readOnly: true; onValueChange?: never; defaultValue?: never }
  );

export function Input({ mono, onValueChange, ...props }: InputProps) {
  const invalid = use(InvalidContext);
  return (
    <SdkInput
      {...props}
      {...(onValueChange === undefined
        ? {}
        : { onChange: (event) => onValueChange(event.currentTarget.value) })}
      className={(s) =>
        cx(
          fieldStyles.control,
          styles.input,
          mono === true && styles.mono,
          s.readOnly && styles.readOnly,
          invalid && styles.invalid,
          s.disabled && styles.disabled,
        )
      }
    />
  );
}

export const fieldStyles = stylex.create({
  control: {
    width: "100%",
    height: size.input,
    paddingInline: space.s3,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: colors.borderDefault,
      ":hover": colors.borderStrong,
      ":focus-visible": colors.accentText,
    },
    borderRadius: radius.control,
    backgroundColor: colors.bgInset,
    color: colors.textPrimary,
    font: "inherit",
    // 터치 기기(iPad Safari 포함)는 16px 보다 작은 입력을 포커스 때 확대한다. 그래서 폭이 아니라
    // 정밀 포인터(마우스·트랙패드)일 때만 본문 크기로 줄인다(티켓 0050).
    fontSize: {
      default: fontSize.input,
      "@media (pointer: fine)": fontSize.body,
    },
    transitionProperty: "border-color",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentSoft}` },
    outlineOffset: 0,
  },
});

const styles = stylex.create({
  field: { display: "flex", flexDirection: "column", gap: space.px6 },
  label: { color: colors.textSecondary, fontWeight: fontWeight.medium },
  description: {
    margin: 0,
    color: colors.textTertiary,
    fontSize: fontSize.small,
    textWrap: "pretty",
  },
  error: { margin: 0, color: colors.problem, fontSize: fontSize.small },
  input: {
    "::placeholder": { color: colors.textDisabled },
  },
  mono: { fontFamily: fonts.mono },
  readOnly: { color: colors.textSecondary },
  invalid: {
    borderColor: {
      default: colors.problem,
      ":hover": colors.problem,
      ":focus-visible": colors.problem,
    },
  },
  disabled: { color: colors.textDisabled, cursor: "not-allowed" },
});
