import * as stylex from "@stylexjs/stylex";

export const colors = stylex.defineVars({
  bgCanvas: "oklch(0.14 0 0)",
  bgSidebar: "oklch(0.16 0 0)",
  bgPanel: "oklch(0.165 0 0)",
  bgRaised: "oklch(0.21 0 0)",
  bgRaisedHover: "oklch(0.235 0 0)",
  bgHover: "oklch(0.19 0 0)",
  bgSelected: "oklch(0.235 0.02 80)",
  bgInset: "oklch(0.12 0 0)",
  bgCard: "oklch(0.175 0 0)",
  bgCardHover: "oklch(0.205 0 0)",
  bgControl: "oklch(0.235 0 0)",
  bgControlHover: "oklch(0.265 0 0)",
  backdrop: "oklch(0.08 0 0 / 0.6)",

  borderSubtle: "oklch(0.21 0 0)",
  borderDefault: "oklch(0.285 0 0)",
  borderStrong: "oklch(0.375 0 0)",

  meterFill: "oklch(0.62 0 0)",
  meterTrack: "oklch(0.27 0 0)",

  textPrimary: "oklch(0.97 0.003 85)",
  textSecondary: "oklch(0.8 0.004 85)",
  textTertiary: "oklch(0.68 0.004 85)",
  textDisabled: "oklch(0.5 0.003 85)",
  textOnAccent: "oklch(0.14 0 0)",
  textOnProblem: "oklch(0.14 0 0)",

  accent: "oklch(0.84 0.15 75)",
  accentHover: "oklch(0.88 0.12 85)",
  accentText: "oklch(0.86 0.13 80)",
  accentSoft: "oklch(0.3 0.06 80)",

  answer: "oklch(0.76 0.13 300)",
  answerSoft: "oklch(0.3 0.07 300)",
  check: "oklch(0.82 0.11 195)",
  checkSoft: "oklch(0.3 0.05 195)",
  problem: "oklch(0.72 0.16 25)",
  problemSoft: "oklch(0.29 0.07 25)",
  problemBorder: "oklch(0.72 0.16 25 / 0.45)",
  progress: "oklch(0.76 0.14 150)",
  progressSoft: "oklch(0.29 0.06 150)",
  merged: "oklch(0.74 0.11 245)",
  mergedSoft: "oklch(0.3 0.06 245)",
  idle: "oklch(0.72 0 0)",
  idleSoft: "oklch(0.27 0 0)",
});

export const brand = stylex.defineVars({
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
    "0 0 0 1px oklch(0.285 0 0), 0 8px 24px oklch(0 0 0 / 0.4), 0 2px 6px oklch(0 0 0 / 0.3)",
});

export const motion = stylex.defineVars({
  easeOut: "cubic-bezier(0.23, 1, 0.32, 1)",
  durationFast: "150ms",
  durationToast: "180ms",
});

export const size = stylex.defineVars({
  sidebarWidth: "216px",
  railWidth: "84px",
  iconButton: "40px",
  railAvatar: "36px",
  railIcon: "24px",
  issueBadge: "16px",
  panelWidth: "384px",
  editorListWidth: "320px",
  control: "32px",
  input: "36px",
  rowMinHeight: "52px",
  dot: "6px",
  pill: "22px",
  icon: "14px",
  tick: "18px",
  markerLarge: "28px",
  textareaMinHeight: "72px",
  noticeWidth: "720px",
  formWidth: "640px",
  detailPageWidth: "1280px",
  detailAsideWidth: "360px",
  statsPageWidth: "1100px",
  failureBarWidth: "160px",
  statsCountColumn: "64px",
  statsDurationColumn: "80px",
  statsBreakdownMinWidth: "360px",
  logMaxHeight: "480px",
  stepNavWidth: "240px",
  stepContentWidth: "760px",
  searchMinWidth: "216px",
  searchMaxWidth: "320px",
  ticketKeyColumn: "112px",
  projectColumn: "128px",
  lastRunColumn: "160px",
  runStatusColumn: "160px",
  elapsedColumn: "88px",
  runnerStatusColumn: "112px",
  capacityColumn: "160px",
  usageColumn: "160px",
  fieldMinWidth: "200px",
  compareMinWidth: "220px",
  dashboardSideWidth: "340px",
  todoTextMinWidth: "256px",
  labelTextMinWidth: "280px",
  labelSelectWidth: "240px",
  mappingTableMinWidth: "640px",
  mappingCellMinWidth: "140px",
});

export const breakpoints = stylex.defineConsts({
  narrowScreen: "@media (max-width: 600px)",
  stepsStacked: "@media (max-width: 900px)",
  detailStacked: "@media (max-width: 960px)",
  dashboardOneColumn: "@container (max-width: 719px)",
  statTilesTwoColumns: "@container (min-width: 481px) and (max-width: 880px)",
  statTilesStacked: "@container (max-width: 480px)",
  statsChartsStacked: "@container (max-width: 880px)",
  chartLabelsSparse: "@container (max-width: 400px)",
  failureBarsBelow: "@container (max-width: 400px)",
  statsLegendBelow: "@container (max-width: 480px)",
  statsBreakdownScrolls: "@container (max-width: 359px)",
});
