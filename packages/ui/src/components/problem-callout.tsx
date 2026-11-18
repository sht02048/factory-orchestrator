import * as stylex from "@stylexjs/stylex";
import { useId, type ReactNode } from "react";
import { colors, fontSize, fontWeight, radius, size, space } from "../tokens.stylex";
import { surfaceStyles } from "./card";
import { textStyles } from "./text";

export interface ProblemCalloutProps {
  title: ReactNode;
  children?: ReactNode;
  steps?: ReadonlyArray<ReactNode>;
  actions?: ReactNode;
}

export function ProblemCallout({ title, children, steps, actions }: ProblemCalloutProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} {...stylex.props(surfaceStyles("problem"), styles.callout)}>
      <div {...stylex.props(styles.head)}>
        <span aria-hidden="true" {...stylex.props(styles.dot)} />
        <h3 id={titleId} {...stylex.props(textStyles("title"), styles.title)}>
          {title}
        </h3>
      </div>
      {children === undefined ? null : (
        <div {...stylex.props(textStyles("body"), styles.body)}>{children}</div>
      )}
      {steps === undefined || steps.length === 0 ? null : (
        <ol {...stylex.props(styles.steps)}>
          {steps.map((step, index) => (
            <li key={index} {...stylex.props(styles.step)}>
              <span aria-hidden="true" {...stylex.props(styles.stepNumber)}>
                {index + 1}
              </span>
              <span {...stylex.props(styles.stepText)}>{step}</span>
            </li>
          ))}
        </ol>
      )}
      {actions === undefined ? null : <div {...stylex.props(styles.actions)}>{actions}</div>}
    </section>
  );
}

const styles = stylex.create({
  callout: { display: "flex", flexDirection: "column", gap: space.s3 },
  head: { display: "flex", alignItems: "center", gap: space.s2 },
  dot: {
    flexShrink: 0,
    width: size.dot,
    height: size.dot,
    borderRadius: radius.full,
    backgroundColor: colors.problem,
  },
  title: { fontWeight: fontWeight.semibold },
  body: { color: colors.textSecondary },
  steps: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  step: { display: "flex", alignItems: "baseline", gap: space.s2 },
  stepNumber: {
    display: "inline-grid",
    flexShrink: 0,
    placeItems: "center",
    width: 18,
    height: 18,
    borderRadius: radius.full,
    backgroundColor: colors.bgCanvas,
    color: colors.textSecondary,
    fontSize: fontSize.label,
    fontWeight: fontWeight.semibold,
    fontVariantNumeric: "tabular-nums",
  },
  stepText: { color: colors.textSecondary, fontSize: fontSize.body },
  actions: { display: "flex", flexWrap: "wrap", gap: space.s2 },
});
