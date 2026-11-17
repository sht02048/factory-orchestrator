import * as stylex from "@stylexjs/stylex";

export type StyleArg = stylex.StyleXStyles | false | null | undefined;

/** UI SDK 의 className 상태 함수에 넘길 StyleX 클래스 문자열을 만든다. */
export function cx(...styles: ReadonlyArray<StyleArg>): string {
  return stylex.props(...styles).className ?? "";
}
