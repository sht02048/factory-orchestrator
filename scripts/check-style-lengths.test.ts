import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  checkedFiles,
  findInFiles,
  findLengthLiterals,
  isChecked,
  isLengthProperty,
} from "./check-style-lengths.ts";

const texts = (source: string, kind: "code" | "css" = "code") =>
  findLengthLiterals(source, kind).map((f) => [f.line, f.text]);

describe("findLengthLiterals", () => {
  it("문자열 안의 px·rem·em 길이를 찾는다", () => {
    const source = [
      'const a = { maxWidth: "720px" };',
      'const b = { gridTemplateColumns: "minmax(0, 1fr) 160px 88px" };',
      'const c = "@container (max-width: 44rem)";',
      'const d = { gap: "0.5em" };',
      "const e = `calc(100% - 1px)`;",
    ].join("\n");
    expect(texts(source)).toEqual([
      [1, "720px"],
      [2, "160px"],
      [2, "88px"],
      [3, "44rem"],
      [4, "0.5em"],
      [5, "1px"],
    ]);
  });

  it("단위 없는 숫자도 여백·간격·둥글기·폭 속성이면 찾는다", () => {
    const source = [
      "const a = { maxWidth: 720, paddingTop: 8 };",
      "const b = { borderRadius: 6, top: -4 };",
      'const c = { width: { default: 36, "@media (hover: hover)": 40 } };',
      "const d = { gap: 2, outlineOffset: 2, textUnderlineOffset: 3 };",
    ].join("\n");
    expect(texts(source)).toEqual([
      [1, "720"],
      [1, "8"],
      [2, "6"],
      [2, "-4"],
      [3, "36"],
      [3, "40"],
      [4, "2"],
      [4, "2"],
      [4, "3"],
    ]);
  });

  it("숫자 변수에 px 를 이어 붙인 길이를 찾는다", () => {
    expect(texts("const a = { gridTemplateColumns: `${RAIL}px minmax(0, 1fr)` };")).toEqual([
      [1, "px"],
    ]);
  });

  it("0, 토큰, 길이가 아닌 속성의 숫자는 놓아준다", () => {
    const source = [
      "const a = { margin: 0, padding: space.s4, maxWidth: size.noticeWidth };",
      "const b = { flexGrow: 1, zIndex: 2, opacity: 0.5, lineHeight: 1 };",
      "const c = { borderTopWidth: 1, borderWidth: 2, gridColumn: 2 };",
      'const d = { width: "100%", height: "100dvh", transform: "translateY(50%)" };',
      "const e = { columns: `repeat(${n}, minmax(0, 1fr))`, rows: 3 };",
      'const f = { label: "s2 열", id: "h1" };',
    ].join("\n");
    expect(texts(source)).toEqual([]);
  });

  it("CSS 파일은 선언의 길이를 찾고 주석은 건너뛴다", () => {
    const css = ["/* 12px 는 주석 */", "body { margin: 0; padding: 12px; }"].join("\n");
    expect(texts(css, "css")).toEqual([[2, "12px"]]);
  });
});

describe("isLengthProperty", () => {
  it("여백·간격·둥글기·폭·위치 속성을 길이 속성으로 본다", () => {
    for (const name of [
      "margin",
      "marginBlock",
      "padding-inline",
      "gap",
      "columnGap",
      "borderRadius",
      "borderTopLeftRadius",
      "width",
      "maxWidth",
      "minHeight",
      "insetInlineEnd",
      "flexBasis",
      "gridTemplateColumns",
    ]) {
      expect([name, isLengthProperty(name)]).toEqual([name, true]);
    }
    for (const name of ["borderWidth", "zIndex", "flexGrow", "lineHeight", "fontSize", "opacity"]) {
      expect([name, isLengthProperty(name)]).toEqual([name, false]);
    }
  });
});

describe("isChecked", () => {
  it("apps/web 의 화면 코드만 보고, 시험·생성 파일·/ds 토큰 목록은 뺀다", () => {
    expect(isChecked("apps/web/src/runs/runs-screen.tsx")).toBe(true);
    expect(isChecked("apps/web/src/styles/app.css")).toBe(true);
    expect(isChecked("apps/web/src/runs/runs-screen.test.tsx")).toBe(false);
    expect(isChecked("apps/web/src/routeTree.gen.ts")).toBe(false);
    expect(isChecked("apps/web/src/ds/token-preview.tsx")).toBe(false);
    expect(isChecked("apps/desktop/src/main.ts")).toBe(false);
    expect(isChecked("packages/ui/src/components/button.tsx")).toBe(false);
  });
});

describe("apps/web", () => {
  it("길이 값을 직접 쓴 곳이 없다", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const files = checkedFiles(root);
    expect(files.length).toBeGreaterThan(50);
    expect(findInFiles(root, files)).toEqual([]);
  });
});
