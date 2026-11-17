/*
 * packages/ui 밖에서 색 값을 직접 쓰면 실패하는 검사(티켓 0003, ADR 0003).
 * oxlint 에는 StyleX 규칙이 없어 따로 둔다. 색은 @factory/ui/tokens.stylex 의 토큰으로만 쓴다.
 *
 * 잡는 것: hex(#fff, #1a2b3c), 색 함수(rgb(), hsl(), oklch(), color-mix() …),
 * 문자열 전체가 CSS 이름 색인 값("red", "white" …).
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

const COLOR_FUNCTION =
  /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/gi;

// 글자 a–f 가 하나라도 있는 hex. "#418"처럼 숫자만 있는 hex 는 PR 번호와 구분되지 않아 아래 따옴표 규칙으로 잡는다.
const HEX_WITH_LETTER = /#(?=[0-9a-f]*[a-f])(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;
const QUOTED_HEX = /(["'`])(#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4}))\1/gi;

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
const QUOTED_WORD = /(["'`])([a-z]+)\1/gi;

/** 소스 한 개에서 색 리터럴을 찾는다. */
export function findColorLiterals(source: string): ColorLiteral[] {
  const found: ColorLiteral[] = [];
  const lines = source.split("\n");
  lines.forEach((text, index) => {
    const add = (column: number, match: string) => {
      if (!found.some((f) => f.line === index + 1 && f.column === column + 1)) {
        found.push({ line: index + 1, column: column + 1, text: match });
      }
    };
    for (const m of text.matchAll(COLOR_FUNCTION)) add(m.index, m[0]);
    for (const m of text.matchAll(HEX_WITH_LETTER)) add(m.index, m[0]);
    for (const m of text.matchAll(QUOTED_HEX)) {
      const hex = m[2];
      if (hex !== undefined) add(m.index + 1, hex);
    }
    for (const m of text.matchAll(QUOTED_WORD)) {
      const word = m[2];
      if (word !== undefined && NAMED_COLORS.has(word.toLowerCase())) add(m.index + 1, word);
    }
  });
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
    for (const f of findColorLiterals(readFileSync(join(root, file), "utf8"))) {
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
