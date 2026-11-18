import * as stylex from "@stylexjs/stylex";

export const colors = stylex.defineVars({
  bgCanvas: "oklch(0.165 0.008 260)",
  bgSidebar: "oklch(0.185 0.009 260)",
  bgPanel: "oklch(0.19 0.009 260)",
  bgRaised: "oklch(0.235 0.011 260)",
  bgRaisedHover: "oklch(0.26 0.012 260)",
  bgHover: "oklch(0.215 0.011 260)",
  bgSelected: "oklch(0.25 0.022 260)",
  bgInset: "oklch(0.145 0.007 260)",
  bgCard: "oklch(0.2 0.01 260)",
  bgCardHover: "oklch(0.23 0.011 260)",
  bgControl: "oklch(0.26 0.012 260)",
  bgControlHover: "oklch(0.29 0.013 260)",
  backdrop: "oklch(0.1 0.005 260 / 0.6)",

  borderSubtle: "oklch(0.235 0.01 260)",
  borderDefault: "oklch(0.31 0.012 260)",
  borderStrong: "oklch(0.4 0.014 260)",

  textPrimary: "oklch(0.955 0.004 260)",
  textSecondary: "oklch(0.79 0.01 260)",
  textTertiary: "oklch(0.66 0.012 260)",
  textDisabled: "oklch(0.5 0.01 260)",
  textOnAccent: "oklch(0.99 0 0)",
  textOnProblem: "oklch(0.185 0.009 260)",

  accent: "oklch(0.54 0.16 260)",
  accentHover: "oklch(0.595 0.141 260)",
  accentText: "oklch(0.78 0.11 260)",
  accentSoft: "oklch(0.3 0.06 260)",

  answer: "oklch(0.76 0.13 300)",
  answerSoft: "oklch(0.3 0.07 300)",
  check: "oklch(0.83 0.14 85)",
  checkSoft: "oklch(0.31 0.06 85)",
  problem: "oklch(0.7 0.17 25)",
  problemSoft: "oklch(0.29 0.07 25)",
  problemBorder: "oklch(0.7 0.17 25 / 0.45)",
  progress: "oklch(0.76 0.15 150)",
  progressSoft: "oklch(0.29 0.06 150)",
  merged: "oklch(0.78 0.1 245)",
  mergedSoft: "oklch(0.3 0.06 245)",
  idle: "oklch(0.72 0.01 260)",
  idleSoft: "oklch(0.27 0.01 260)",
});

export const brand = stylex.defineVars({
  yellow: "oklch(0.84 0.15 75)",
  ink: "oklch(0.14 0 0)",
  paper: "oklch(0.97 0.003 85)",
  body: "oklch(0.97 0 0)",
  eye: "oklch(0.12 0 0)",
  snore: "oklch(0.66 0 0)",
});

export const space = stylex.defineVars({
  px2: "2px",
  s1: "4px",
  px6: "6px",
  s2: "8px",
  s3: "12px",
  s4: "16px",
  s5: "20px",
  s6: "24px",
  s8: "32px",
  s10: "40px",
});

export const radius = stylex.defineVars({
  card: "12px",
  control: "8px",
  pill: "6px",
  full: "9999px",
});

export const fonts = stylex.defineVars({
  sans: '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Segoe UI", "Noto Sans KR", sans-serif',
  mono: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
});

export const fontSize = stylex.defineVars({
  display: "26px",
  page: "22px",
  heading: "20px",
  panel: "17px",
  subheading: "15px",
  body: "14px",
  ui: "13px",
  small: "12px",
  label: "11px",
  input: "16px",
});

export const fontWeight = stylex.defineVars({
  regular: "400",
  medium: "500",
  semibold: "600",
});

export const lineHeight = stylex.defineVars({
  tight: "1.2",
  snug: "1.35",
  normal: "1.5",
  relaxed: "1.55",
});

export const letterSpacing = stylex.defineVars({
  display: "-0.015em",
  page: "-0.01em",
  panel: "-0.005em",
  label: "0.04em",
});

export const shadow = stylex.defineVars({
  popover:
    "0 0 0 1px oklch(0.31 0.012 260), 0 8px 24px oklch(0 0 0 / 0.4), 0 2px 6px oklch(0 0 0 / 0.3)",
});

export const motion = stylex.defineVars({
  easeOut: "cubic-bezier(0.23, 1, 0.32, 1)",
  durationFast: "150ms",
  durationToast: "180ms",
});

export const size = stylex.defineVars({
  sidebarWidth: "216px",
  panelWidth: "384px",
  editorListWidth: "320px",
  control: "32px",
  input: "36px",
  rowMinHeight: "52px",
  dot: "6px",
  pill: "22px",
  icon: "14px",
});
