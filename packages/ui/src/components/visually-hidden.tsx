import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

export function VisuallyHidden({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <span {...(id === undefined ? {} : { id })} {...stylex.props(visuallyHiddenStyles.hidden)}>
      {children}
    </span>
  );
}

export const visuallyHiddenStyles = stylex.create({
  hidden: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
    borderWidth: 0,
  },
});
