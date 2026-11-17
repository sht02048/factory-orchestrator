import { describe, expect, it } from "vitest";

import { findColorLiterals, isChecked } from "./check-color-literals.ts";

describe("findColorLiterals", () => {
  it("hex, 색 함수, 이름 색을 찾는다", () => {
    const source = [
      'const a = { color: "#fff" };',
      'const b = { backgroundColor: "#1a2b3c80" };',
      'const c = { color: "oklch(0.7 0.18 25)" };',
      "const d = `rgb(0 0 0 / 0.5)`;",
      'const e = { borderColor: "color-mix(in oklch, red 50%, blue)" };',
      'const f = { color: "white" };',
      'const g = { color: "#123456" };',
      "body { background: hsl(210 20% 10%); }",
    ].join("\n");

    expect(findColorLiterals(source).map((f) => [f.line, f.text])).toEqual([
      [1, "#fff"],
      [2, "#1a2b3c80"],
      [3, "oklch("],
      [4, "rgb("],
      [5, "color-mix("],
      [6, "white"],
      [7, "#123456"],
      [8, "hsl("],
    ]);
  });

  it("토큰, 키워드, 색이 아닌 #·이름은 놓아준다", () => {
    const source = [
      "const a = { color: colors.textPrimary, borderColor: 'transparent' };",
      'const b = { color: "currentColor", fill: "inherit" };',
      "const c = `PR #418 열기`;",
      'const d = <a href="#colors">색</a>;',
      "const e = `#${run.number}`;",
      "const f = textColor(value);",
      "const g = label(1);",
      'const h = "redirect";',
    ].join("\n");

    expect(findColorLiterals(source)).toEqual([]);
  });

  it("줄과 열을 1부터 센다", () => {
    expect(findColorLiterals('\n  x: "#abc"')).toEqual([{ line: 2, column: 7, text: "#abc" }]);
  });
});

describe("isChecked", () => {
  it("packages/ui 밖의 코드 파일만 본다", () => {
    expect(isChecked("apps/web/src/routes/ds.tsx")).toBe(true);
    expect(isChecked("apps/web/src/styles/app.css")).toBe(true);
    expect(isChecked("packages/core/src/index.ts")).toBe(true);
    expect(isChecked("packages/ui/src/tokens.stylex.ts")).toBe(false);
    expect(isChecked("apps/web/src/routeTree.gen.ts")).toBe(false);
    expect(isChecked("apps/web/dist/client/assets/app.css")).toBe(false);
    expect(isChecked("apps/web/messages/ko.json")).toBe(false);
    expect(isChecked("design/prototype/styles.css")).toBe(false);
  });
});
