import * as stylex from "@stylexjs/stylex";
import { Field as SdkField, FieldDescription, FieldError, FieldLabel } from "@ui-sdk/react/field";
import { Input as SdkInput } from "@ui-sdk/react/input";
import { createContext, use, type KeyboardEventHandler, type ReactNode, type Ref } from "react";
import { cx } from "../cx";
import {
  colors,
  fonts,
  fontSize,
  fontWeight,
  lineHeight,
  motion,
  radius,
  size,
  space,
} from "../tokens.stylex";

export interface FieldProps {
  label: ReactNode;
  info?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}

const InvalidContext = createContext(false);

export function Field({ label, info, description, error, children }: FieldProps) {
  const invalid = error !== undefined && error !== null && error !== false && error !== "";
  return (
    <SdkField invalid={invalid} className={cx(styles.field)}>
      {info === undefined || info === null ? (
        <FieldLabel className={cx(styles.label)}>{label}</FieldLabel>
      ) : (
        <span {...stylex.props(styles.labelLine)}>
          <FieldLabel className={cx(styles.label)}>{label}</FieldLabel>
          {info}
        </span>
      )}
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
  mono?: boolean;
  invalid?: boolean;
  spellCheck?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  ref?: Ref<HTMLInputElement>;
  [data: `data-${string}`]: string | boolean | undefined;
}

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

export function Input({
  mono,
  invalid: invalidProp,
  spellCheck,
  onValueChange,
  ...props
}: InputProps) {
  const invalid = use(InvalidContext) || invalidProp === true;
  const checkSpelling = spellCheck ?? (mono === true ? false : undefined);
  return (
    <SdkInput
      {...props}
      {...(checkSpelling === undefined ? {} : { spellCheck: checkSpelling })}
      {...(invalidProp === true ? { "aria-invalid": true } : {})}
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

export interface TextareaProps {
  value: string;
  onValueChange: (value: string) => void;
  name?: string;
  rows?: number;
  placeholder?: string;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ onValueChange, ...props }: TextareaProps) {
  const invalid = use(InvalidContext);
  return (
    <textarea
      {...props}
      onChange={(event) => onValueChange(event.currentTarget.value)}
      {...stylex.props(fieldStyles.control, styles.textarea, invalid && styles.invalid)}
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
  labelLine: { display: "flex", alignItems: "center", gap: space.s1 },
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
  textarea: {
    display: "block",
    height: "auto",
    minHeight: size.textareaMinHeight,
    paddingBlock: space.s2,
    lineHeight: lineHeight.normal,
    resize: "vertical",
  },
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
