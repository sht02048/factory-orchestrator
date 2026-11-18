import * as stylex from "@stylexjs/stylex";

/*
 * 디자인 토큰. 값의 출처는 시안 B(design/prototype/styles.css)와 ADR 0010 의 색·둥글기 규칙이다.
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
  // 면: 영역을 선이 아니라 배경색으로 나눈다(ADR 0010 10번). 카드 < 카드 안 행 hover < 보조 버튼.
  bgCard: "oklch(0.2 0.01 260)",
  bgCardHover: "oklch(0.23 0.011 260)",
  bgControl: "oklch(0.26 0.012 260)",
  bgControlHover: "oklch(0.29 0.013 260)",
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

  // 상태 색. 색 하나에 뜻 하나다(ADR 0010 5번). 글·점은 기본 값, 알약 바탕은 Soft 를 쓴다.
  // 보라: 사람이 답·허용(Question, Permission, Waiting for Input).
  answer: "oklch(0.76 0.13 300)",
  answerSoft: "oklch(0.3 0.07 300)",
  // 노랑: 사람이 확인(Human Check).
  check: "oklch(0.83 0.14 85)",
  checkSoft: "oklch(0.31 0.06 85)",
  // 빨강: 문제(Failed, Disconnected, Runner Issue, Offline). 위험 행동 글자와 입력 오류도 이 색이다.
  problem: "oklch(0.7 0.17 25)",
  problemSoft: "oklch(0.29 0.07 25)",
  problemBorder: "oklch(0.7 0.17 25 / 0.45)",
  // 초록: 진행·정상(Running, Online).
  progress: "oklch(0.76 0.15 150)",
  progressSoft: "oklch(0.29 0.06 150)",
  // 파랑: 병합(Merged). 주 버튼의 accent 보다 옅게 두어 행동과 상태를 가른다.
  merged: "oklch(0.78 0.1 245)",
  mergedSoft: "oklch(0.3 0.06 245)",
  // 회색: 대기·멈춤(Queued, Canceled). 무채색이다.
  idle: "oklch(0.72 0.01 260)",
  idleSoft: "oklch(0.27 0.01 260)",
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

// 둥글기(ADR 0010 10번): 카드 12, 버튼·행·입력 8, 알약 6. full 은 점과 아바타에만.
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
  dot: "6px",
  pill: "22px",
  icon: "14px",
});
