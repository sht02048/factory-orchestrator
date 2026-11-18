import * as stylex from "@stylexjs/stylex";

export type StyleArg = stylex.StyleXStyles | false | null | undefined;

export function cx(...styles: ReadonlyArray<StyleArg>): string {
  return stylex.props(...styles).className ?? "";
}
