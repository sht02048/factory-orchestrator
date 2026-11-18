import * as stylex from "@stylexjs/stylex";
import { brand } from "../tokens.stylex";

export const WHISTLE_BODY =
  "M40 34h36a8 8 0 0 1 8 8v4a8 8 0 0 1-8 8H63.66A24 24 0 1 1 40 34zM40 49.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17z";
export const WHISTLE_MOUTHPIECE = { x: 66, y: 26, width: 11, height: 10, rx: 2.5 } as const;
export const WHISTLE_VIEW_BOX = "5 9 90 90";

export const MASCOT_BODY = "M20 58a30 30 0 0 1 60 0v8a14 14 0 0 1-14 14H34a14 14 0 0 1-14-14z";
export const MASCOT_BRIM = "M16 46h56a10 10 0 0 1 10 10H26a10 10 0 0 1-10-10z";
export const WORRIED_BROWS = "M33 61l9-3M67 61l-9-3";

export type MarkTone = "brand" | "mono";
export type MarkSize = "small" | "medium" | "large";

export interface GangerMarkProps {
  tone?: MarkTone;
  size?: MarkSize;
  label?: string;
}

export function GangerMark({ tone = "mono", size = "medium", label }: GangerMarkProps) {
  const naming =
    label === undefined
      ? ({ "aria-hidden": true } as const)
      : ({ role: "img", "aria-label": label } as const);
  return (
    <svg
      viewBox={WHISTLE_VIEW_BOX}
      focusable="false"
      data-mark-tone={tone}
      {...naming}
      {...stylex.props(styles.svg, markSizes[size])}
    >
      <path d={WHISTLE_BODY} fillRule="evenodd" {...stylex.props(styles.current)} />
      <rect
        {...WHISTLE_MOUTHPIECE}
        {...stylex.props(tone === "brand" ? styles.yellow : styles.current)}
      />
    </svg>
  );
}

export const MASCOT_MOODS = ["default", "signal", "resting", "worried"] as const;
export type MascotMood = (typeof MASCOT_MOODS)[number];
export type MascotSize = "small" | "medium" | "large";

export interface MascotProps {
  mood: MascotMood;
  size?: MascotSize;
}

export function Mascot({ mood, size = "medium" }: MascotProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
      data-mascot={mood}
      {...stylex.props(styles.svg, mascotSizes[size])}
    >
      <path d={MASCOT_BODY} {...stylex.props(styles.body)} />
      <path d={MASCOT_BRIM} {...stylex.props(styles.yellow)} />
      <MascotFace mood={mood} />
    </svg>
  );
}

function MascotFace({ mood }: { mood: MascotMood }) {
  switch (mood) {
    case "default":
      return (
        <>
          <circle cx="38" cy="66" r="4.3" {...stylex.props(styles.eye)} />
          <path d="M57 66.5q5-5 10 0" strokeWidth="3.6" {...stylex.props(styles.eyeLine)} />
        </>
      );
    case "signal":
      return (
        <>
          <circle cx="38" cy="64" r="4.3" {...stylex.props(styles.eye)} />
          <circle cx="62" cy="64" r="4.3" {...stylex.props(styles.eye)} />
          <circle cx="47" cy="75" r="4.2" {...stylex.props(styles.eye)} />
          <rect x="47" y="70.8" width="11" height="4.4" rx="2.2" {...stylex.props(styles.eye)} />
          <path d="M84 33l7-5M86 41.5l8.5-0.5" strokeWidth="3" {...stylex.props(styles.sound)} />
        </>
      );
    case "resting":
      return (
        <>
          <path
            d="M33 66q5 4 10 0M57 66q5 4 10 0"
            strokeWidth="3.6"
            {...stylex.props(styles.eyeLine)}
          />
          <path d="M79 30h7l-7 8h7" strokeWidth="2.6" {...stylex.props(styles.snore)} />
          <path d="M89 17h5l-5 6h5" strokeWidth="2.2" {...stylex.props(styles.snore)} />
        </>
      );
    case "worried":
      return (
        <>
          <circle cx="38" cy="67" r="4.3" {...stylex.props(styles.eye)} />
          <circle cx="62" cy="67" r="4.3" {...stylex.props(styles.eye)} />
          <path d={WORRIED_BROWS} strokeWidth="3" {...stylex.props(styles.eyeLine)} />
        </>
      );
  }
}

const line = {
  fill: "none",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const styles = stylex.create({
  svg: { display: "block", flexShrink: 0 },
  current: { fill: "currentColor" },
  yellow: { fill: brand.yellow },
  body: { fill: brand.body },
  eye: { fill: brand.eye },
  eyeLine: { ...line, stroke: brand.eye },
  sound: { ...line, stroke: brand.yellow },
  snore: { ...line, stroke: brand.snore },
});

const markSizes = stylex.create({
  small: { width: 16, height: 16 },
  medium: { width: 28, height: 28 },
  large: { width: 64, height: 64 },
});

const mascotSizes = stylex.create({
  small: { width: 56, height: 56 },
  medium: { width: 88, height: 88 },
  large: { width: 128, height: 128 },
});
