import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { space } from "../tokens.stylex";
import { Mascot, type MascotMood, type MascotSize } from "./brand";

export type MascotMessageAlign = "center" | "start";

export interface MascotMessageProps {
  mood: MascotMood;
  size?: MascotSize;
  align?: MascotMessageAlign;
  children: ReactNode;
}

export function MascotMessage({
  mood,
  size = "medium",
  align = "center",
  children,
}: MascotMessageProps) {
  return (
    <div {...stylex.props(styles.frame, aligns[align])}>
      <Mascot mood={mood} size={size} />
      <div {...stylex.props(styles.text, aligns[align])}>{children}</div>
    </div>
  );
}

const styles = stylex.create({
  frame: { display: "flex", flexDirection: "column", gap: space.s4 },
  text: { display: "flex", flexDirection: "column", gap: space.s2 },
});

const aligns = stylex.create({
  center: { alignItems: "center", textAlign: "center" },
  start: { alignItems: "flex-start", textAlign: "start" },
});
