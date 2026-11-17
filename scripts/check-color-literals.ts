/*
 * packages/ui 밖에서 색 값을 직접 쓰면 실패하는 검사(티켓 0003, ADR 0003).
 * oxlint 에는 StyleX 규칙이 없어 따로 둔다. 색은 @factory/ui/tokens.stylex 의 토큰으로만 쓴다.
 *
 * 잡는 것: hex(#fff, #1a2b3c), 색 함수(rgb(), hsl(), oklch(), color-mix() …), 이름 색(red, white …).
 * CSS 파일은 선언 값 전체를, 코드 파일은 CSS 값 문맥(color: "red", "1px solid #000")을 본다.
 * 놓아주는 것: transparent, currentColor, inherit 같은 키워드.
 *
 * 실행: node scripts/check-color-literals.ts [파일 …]
 * 파일을 주지 않으면 apps/ 와 packages/(packages/ui 제외) 아래 코드 파일을 모두 본다.
 */

import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface ColorLiteral {
  line: number;
  column: number;
  text: string;
}

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".css",
]);

const SKIP_DIRS = new Set(["node_modules", "dist", ".turbo", ".output", "coverage"]);

// 생성 파일과 디자인 시스템 자체는 검사하지 않는다.
const SKIP_FILES = new Set(["routeTree.gen.ts"]);
const ALLOWED_ROOT = join("packages", "ui");

// 앞이 . 이면 메서드 호출(d3.color(x))이라 놓아준다.
const COLOR_FUNCTION =
  /(?<![\w.-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/gi;

// 글자 a–f 가 하나라도 있는 hex.
const HEX_WITH_LETTER = /#(?=[0-9a-f]*[a-f])(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;
// 숫자만 있는 hex 는 PR 번호(#418)와 구분되지 않아, 코드에서는 CSS 값 문맥에서만 잡는다:
// 문자열 전체이거나, 테두리·그림자 값 안(solid #000, 1px #000, , #000).
const HEX = "#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\\w-])";
const QUOTED_HEX = new RegExp(`(["'\`])(${HEX})\\1`, "gi");
const HEX_IN_CSS_VALUE = new RegExp(
  `(?:\\b(?:solid|dashed|dotted|double|inset)|\\d(?:px|em|rem)|,)\\s+(${HEX})`,
  "gi",
);
// CSS 파일에서는 모든 hex 를 잡는다.
const ANY_HEX = new RegExp(HEX, "gi");

const NAMED_COLORS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet " +
    "brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue " +
    "darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange " +
    "darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise " +
    "darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia " +
    "gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo " +
    "ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
    "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue " +
    "lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon " +
    "mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue " +
    "mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin " +
    "navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen " +
    "paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red " +
    "rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue " +
    "slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white " +
    "whitesmoke yellow yellowgreen"
  ).split(" "),
);
// 코드: 속성 값으로 준 이름 색(color: "red"), 테두리·그림자 값 안의 이름 색("1px solid red").
// 맨 문자열("gold" 플랜 이름 등)은 색으로 보지 않는다.
const NAMED_AS_VALUE = /:\s*(["'`])([a-z]+)\1/gi;
const NAMED_IN_CSS_VALUE =
  /(?<=(?:\b(?:solid|dashed|dotted|double|inset)|\d(?:px|em|rem|%)?)\s+)([a-z]+)\b/gi;
// CSS: 선언 값(: 와 ; 사이)의 낱말.
const CSS_DECLARATION = /:([^;{}]*)(?:;|}|$)/g;
const WORD = /[a-z]+/gi;

export type SourceKind = "code" | "css";

/** 소스 한 개에서 색 리터럴을 찾는다. */
export function findColorLiterals(source: string, kind: SourceKind = "code"): ColorLiteral[] {
  const found: ColorLiteral[] = [];
  const text =
    kind === "css" ? source.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")) : source;
  const lineStarts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === "\n") lineStarts.push(i + 1);
  const add = (offset: number, match: string) => {
    let line = lineStarts.length - 1;
    while ((lineStarts[line] ?? 0) > offset) line -= 1;
    const column = offset - (lineStarts[line] ?? 0) + 1;
    if (!found.some((f) => f.line === line + 1 && f.column === column)) {
      found.push({ line: line + 1, column, text: match });
    }
  };
  const isNamed = (word: string | undefined): word is string =>
    word !== undefined && NAMED_COLORS.has(word.toLowerCase());

  for (const m of text.matchAll(COLOR_FUNCTION)) add(m.index, m[0]);
  for (const m of text.matchAll(HEX_WITH_LETTER)) add(m.index, m[0]);

  if (kind === "css") {
    for (const m of text.matchAll(ANY_HEX)) add(m.index, m[0]);
    for (const d of text.matchAll(CSS_DECLARATION)) {
      const value = d[1] ?? "";
      const base = d.index + 1;
      for (const w of value.matchAll(WORD)) if (isNamed(w[0])) add(base + w.index, w[0]);
    }
  } else {
    for (const m of text.matchAll(QUOTED_HEX)) {
      if (m[2] !== undefined) add(m.index + 1, m[2]);
    }
    for (const m of text.matchAll(HEX_IN_CSS_VALUE)) {
      const hex = m[1];
      if (hex !== undefined) add(m.index + m[0].length - hex.length, hex);
    }
    for (const m of text.matchAll(NAMED_AS_VALUE)) {
      if (isNamed(m[2])) add(m.index + m[0].length - m[2].length - 1, m[2]);
    }
    for (const m of text.matchAll(NAMED_IN_CSS_VALUE)) {
      if (isNamed(m[1])) add(m.index + m[0].length - m[1].length, m[1]);
    }
  }
  return found.sort((a, b) => a.line - b.line || a.column - b.column);
}

/** 이 경로가 검사 대상인지(저장소 루트 기준 상대 경로). */
export function isChecked(path: string): boolean {
  const normalized = path.split(sep).join("/");
  if (!/^(apps|packages)\//.test(normalized)) return false;
  if (normalized === ALLOWED_ROOT.split(sep).join("/") || normalized.startsWith("packages/ui/")) {
    return false;
  }
  const parts = normalized.split("/");
  if (parts.some((p) => SKIP_DIRS.has(p))) return false;
  const name = parts.at(-1) ?? "";
  if (SKIP_FILES.has(name)) return false;
  return CODE_EXTENSIONS.has(extname(name));
}

function walk(root: string, dir: string, out: string[]): void {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && path !== ALLOWED_ROOT) walk(root, path, out);
    } else if (isChecked(path)) {
      out.push(path);
    }
  }
}

function main(argv: ReadonlyArray<string>): number {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const files =
    argv.length > 0
      ? argv.map((f) => relative(root, resolve(f))).filter(isChecked)
      : ["apps", "packages"].flatMap((dir) => {
          const out: string[] = [];
          walk(root, dir, out);
          return out;
        });

  let count = 0;
  for (const file of files) {
    const kind = extname(file) === ".css" ? "css" : "code";
    for (const f of findColorLiterals(readFileSync(join(root, file), "utf8"), kind)) {
      count += 1;
      console.error(`${file}:${f.line}:${f.column}  색 값 ${f.text} 을(를) 직접 썼어요`);
    }
  }
  if (count > 0) {
    console.error(
      `\n색 값 ${count}개를 packages/ui 밖에서 직접 썼어요. @factory/ui/tokens.stylex 의 colors 토큰으로 바꿔요(packages/ui/DESIGN.md).`,
    );
    return 1;
  }
  console.log(`색 리터럴 검사: 파일 ${files.length}개, 위반 없음`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
