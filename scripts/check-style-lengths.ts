import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface LengthLiteral {
  line: number;
  column: number;
  text: string;
}

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".turbo", ".output", "coverage"]);
const SKIP_FILES = new Set(["routeTree.gen.ts"]);
const CHECKED_ROOT = "apps/web/";
const TOKEN_CATALOG_ROOT = "apps/web/src/ds/";
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

const UNIT_LENGTH = /(?<![\w$.#-])-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em)(?![\w-])/gi;
const INTERPOLATED_UNIT = /\}(?:px|rem|em)(?![\w-])/gi;
const OBJECT_KEY = /(?<![\w$.-])(["']?)([A-Za-z_$][\w$-]*)\1\s*:(?!:)/g;
const NUMBER = /(?<![\w$.#-])-?(?:\d+\.?\d*|\.\d+)(?![\w.%])/g;

const LENGTH_PROPERTIES = new Set([
  "gap",
  "rowgap",
  "columngap",
  "gridgap",
  "width",
  "height",
  "minwidth",
  "maxwidth",
  "minheight",
  "maxheight",
  "inlinesize",
  "blocksize",
  "mininlinesize",
  "maxinlinesize",
  "minblocksize",
  "maxblocksize",
  "top",
  "right",
  "bottom",
  "left",
  "flexbasis",
  "gridtemplatecolumns",
  "gridtemplaterows",
  "gridautocolumns",
  "gridautorows",
  "outlineoffset",
  "textunderlineoffset",
]);
const LENGTH_PREFIXES = ["margin", "padding", "inset", "scrollmargin", "scrollpadding"];

export function isLengthProperty(name: string): boolean {
  const key = name.replace(/-/g, "").toLowerCase();
  return (
    LENGTH_PROPERTIES.has(key) ||
    key.endsWith("radius") ||
    LENGTH_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

export type SourceKind = "code" | "css";

function blankOut(text: string): string {
  return text.replace(/[^\n]/g, " ");
}

function codeOutsideStrings(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? "";
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) j += text[j] === "\\" ? 2 : 1;
      out += ch + blankOut(text.slice(i + 1, j)) + (text[j] ?? "");
      i = j + 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function valueEnd(code: string, start: number): number {
  let depth = 0;
  for (let i = start; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) return i;
      depth -= 1;
    } else if (depth === 0 && (ch === "," || ch === ";")) return i;
  }
  return code.length;
}

function isZero(text: string): boolean {
  return Number.parseFloat(text) === 0;
}

export function findLengthLiterals(source: string, kind: SourceKind = "code"): LengthLiteral[] {
  const text = kind === "css" ? source.replace(/\/\*[\s\S]*?\*\//g, blankOut) : source;
  const found: LengthLiteral[] = [];
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

  for (const m of text.matchAll(UNIT_LENGTH)) if (!isZero(m[0])) add(m.index, m[0]);
  for (const m of text.matchAll(INTERPOLATED_UNIT)) add(m.index + 1, m[0].slice(1));

  if (kind === "code") {
    const code = codeOutsideStrings(text);
    for (const key of code.matchAll(OBJECT_KEY)) {
      if (key[2] === undefined || !isLengthProperty(key[2])) continue;
      const start = key.index + key[0].length;
      const value = code.slice(start, valueEnd(code, start));
      for (const n of value.matchAll(NUMBER)) {
        if (!isZero(n[0])) add(start + n.index, n[0]);
      }
    }
  }
  return found.sort((a, b) => a.line - b.line || a.column - b.column);
}

export function isChecked(path: string): boolean {
  const normalized = path.split(sep).join("/");
  if (!normalized.startsWith(CHECKED_ROOT) || normalized.startsWith(TOKEN_CATALOG_ROOT))
    return false;
  const parts = normalized.split("/");
  if (parts.some((p) => SKIP_DIRS.has(p))) return false;
  const name = parts.at(-1) ?? "";
  if (SKIP_FILES.has(name) || TEST_FILE.test(name)) return false;
  return CODE_EXTENSIONS.has(extname(name));
}

function walk(root: string, dir: string, out: string[]): void {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(root, path, out);
    } else if (isChecked(path)) {
      out.push(path);
    }
  }
}

export interface FileLengthLiteral extends LengthLiteral {
  file: string;
}

export function checkedFiles(root: string): string[] {
  const out: string[] = [];
  walk(root, join("apps", "web"), out);
  return out;
}

export function findInFiles(root: string, files: ReadonlyArray<string>): FileLengthLiteral[] {
  return files.flatMap((file) => {
    const kind = extname(file) === ".css" ? "css" : "code";
    return findLengthLiterals(readFileSync(join(root, file), "utf8"), kind).map((f) => ({
      file,
      ...f,
    }));
  });
}

function main(argv: ReadonlyArray<string>): number {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const files =
    argv.length > 0
      ? argv.map((f) => relative(root, resolve(f))).filter(isChecked)
      : checkedFiles(root);
  const found = findInFiles(root, files);
  for (const f of found) {
    console.error(`${f.file}:${f.line}:${f.column}  길이 값 ${f.text} 을(를) 직접 썼어요`);
  }
  if (found.length > 0) {
    console.error(
      `\n길이 값 ${found.length}개를 apps/web 에서 직접 썼어요. 여백은 space, 폭·높이는 size 토큰, 둥글기는 면 역할로 바꿔요(packages/ui/DESIGN.md).`,
    );
    return 1;
  }
  console.log(`길이 값 검사: 파일 ${files.length}개, 위반 없음`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
