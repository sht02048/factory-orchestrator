import * as stylex from "@stylexjs/stylex";

/*
 * 디자인 토큰. 값의 출처는 시안 B(design/prototype/styles.css)다.
 *
 * - 이 파일은 StyleX 규칙상 defineVars 의 이름 있는 export 만 둔다.
 * - 색은 OKLCH 로만 쓴다. packages/ui 밖에서는 색 값을 직접 쓰지 않고 이 토큰을 쓴다
 *   (scripts/check-color-literals.ts 가 검사한다).
 * - 지금은 다크 테마만 있다. 아래 colors 의 기본값이 다크 값이다. 라이트 테마는
 *   stylex.createTheme(colors, {...}) 로 같은 키를 모두 채워 이 파일에 더한다(DESIGN.md "테마").
 */

export const colors = stylex.defineVars({
  // 바탕: 캔버스 < 사이드바 < 패널 < 떠 있는 면 순서로 밝아진다.
  bgCanvas: "oklch(0.165 0.008 260)",
  bgSidebar: "oklch(0.185 0.009 260)",
  bgPanel: "oklch(0.19 0.009 260)",
  bgRaised: "oklch(0.235 0.011 260)",
  bgRaisedHover: "oklch(0.26 0.012 260)",
  bgHover: "oklch(0.215 0.011 260)",
  bgSelected: "oklch(0.25 0.022 260)",
  bgInset: "oklch(0.145 0.007 260)",
  backdrop: "oklch(0.1 0.005 260 / 0.6)",

  // 선: 구역 나눔은 subtle, 입력·버튼 테두리는 default, 그 위 hover 는 strong.
  borderSubtle: "oklch(0.235 0.01 260)",
  borderDefault: "oklch(0.31 0.012 260)",
  borderStrong: "oklch(0.4 0.014 260)",

  // 글자: primary(제목·값) > secondary(본문·설명) > tertiary(메타·머리글) > disabled.
  textPrimary: "oklch(0.955 0.004 260)",
  textSecondary: "oklch(0.79 0.01 260)",
  textTertiary: "oklch(0.66 0.012 260)",
  textDisabled: "oklch(0.5 0.01 260)",
  textOnAccent: "oklch(0.99 0 0)",

  // 포인트 색 하나(파랑). 주 버튼, 선택 표시, 링크, 포커스 링.
  accent: "oklch(0.54 0.16 260)",
  accentHover: "oklch(0.595 0.141 260)",
  accentText: "oklch(0.78 0.11 260)",
  accentSoft: "oklch(0.3 0.06 260)",

  // 손댈 일에만 쓰는 상태 색(ADR 0007). Human Check 주황, Failed 빨강.
  check: "oklch(0.77 0.15 58)",
  checkSoft: "oklch(0.29 0.05 58)",
  failed: "oklch(0.7 0.18 25)",
  failedSoft: "oklch(0.28 0.06 25)",
  failedBorder: "oklch(0.7 0.18 25 / 0.45)",

  // 러너 Online 점에만 쓴다(ADR 0007 예외). Offline 점은 failed 를 쓴다.
  online: "oklch(0.72 0.15 150)",
  onlineRing: "oklch(0.72 0.15 150 / 0.22)",
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
  sm: "4px",
  md: "6px",
  full: "9999px",
});

export const fonts = stylex.defineVars({
  sans: '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Segoe UI", "Noto Sans KR", sans-serif',
  mono: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
});

// 글자 크기. 위계 1단계(page·panel) / 2단계(body) / 3단계(ui·small·label).
export const fontSize = stylex.defineVars({
  page: "22px",
  panel: "17px",
  body: "14px",
  ui: "13px",
  small: "12px",
  label: "11px",
  // 모바일 Safari 확대를 막는 입력 글자 크기.
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
  /** Settings 처럼 편집 영역이 넓은 화면의 왼쪽 항목 목록 폭(SplitView editor) */
  editorListWidth: "320px",
  control: "32px",
  input: "36px",
  rowMinHeight: "52px",
  dot: "7px",
  icon: "14px",
});
