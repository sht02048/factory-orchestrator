import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const oxlint = join(root, "node_modules", ".bin", "oxlint");

interface Diagnostic {
  code: string;
  filename: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function lintOverrides(json: unknown): { plugins: unknown; overrides: unknown } {
  if (!isRecord(json) || !Array.isArray(json["overrides"])) {
    throw new Error(".oxlintrc.json 에 overrides 가 없어요");
  }
  return { plugins: json["plugins"], overrides: json["overrides"] };
}

function diagnosticsOf(json: unknown): Diagnostic[] {
  if (!isRecord(json) || !Array.isArray(json["diagnostics"])) {
    throw new Error("oxlint JSON 출력을 읽지 못했어요");
  }
  return json["diagnostics"].flatMap((d: unknown) =>
    isRecord(d) && typeof d["code"] === "string" && typeof d["filename"] === "string"
      ? [{ code: d["code"], filename: d["filename"] }]
      : [],
  );
}

const fixtures: Record<string, string> = {
  "apps/web/src/bad-tokens.tsx": [
    'import { colors, fontSize, radius, space } from "@ganger/ui/tokens.stylex";',
    "export const used = [colors, fontSize, radius, space];",
  ].join("\n"),
  "apps/web/src/bad-namespace.tsx": [
    'import * as tokens from "@ganger/ui/tokens.stylex";',
    "export const used = tokens;",
  ].join("\n"),
  "apps/web/src/bad-elements.tsx": [
    "export const Bad = () => (",
    "  <>",
    "    <h1>제목</h1>",
    "    <h2>제목</h2>",
    "    <h3>제목</h3>",
    '    <button type="button">누르기</button>',
    "    <input />",
    "    <select />",
    "    <textarea />",
    "    <table />",
    "  </>",
    ");",
  ].join("\n"),
  "apps/web/src/good.tsx": [
    'import { Button, Text } from "@ganger/ui";',
    'import { size, space } from "@ganger/ui/tokens.stylex";',
    "export const used = [size, space];",
    'export const Good = () => <Text variant="page">제목<Button>누르기</Button></Text>;',
  ].join("\n"),
  "apps/web/src/good.test.tsx": "export const Fixture = () => <button>시험 안 버튼</button>;",
  "apps/web/src/ds/catalog.tsx": [
    'import { colors } from "@ganger/ui/tokens.stylex";',
    "export const used = colors;",
  ].join("\n"),
  "packages/ui/src/inside.tsx": [
    'import { colors } from "./tokens.stylex";',
    "export const Inside = () => <button>{String(colors)}</button>;",
  ].join("\n"),
};

let dir = "";
let codesByFile = new Map<string, string[]>();

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ds-lint-"));
  const config: unknown = JSON.parse(readFileSync(join(root, ".oxlintrc.json"), "utf8"));
  writeFileSync(join(dir, ".oxlintrc.json"), JSON.stringify(lintOverrides(config)));
  for (const [path, source] of Object.entries(fixtures)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), source);
  }
  const run = spawnSync(oxlint, ["-c", ".oxlintrc.json", "-f", "json", ...Object.keys(fixtures)], {
    cwd: dir,
    encoding: "utf8",
  });
  const report: unknown = JSON.parse(run.stdout);
  codesByFile = new Map();
  for (const d of diagnosticsOf(report)) {
    codesByFile.set(d.filename, [...(codesByFile.get(d.filename) ?? []), d.code]);
  }
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const codes = (file: string) => codesByFile.get(file) ?? [];

describe("apps/web 디자인 시스템 lint 규칙(티켓 0074)", () => {
  it("글자·면·색·움직임 토큰을 가져오면 실패한다", () => {
    expect(codes("apps/web/src/bad-tokens.tsx")).toEqual([
      "eslint(no-restricted-imports)",
      "eslint(no-restricted-imports)",
      "eslint(no-restricted-imports)",
    ]);
    expect(codes("apps/web/src/bad-namespace.tsx")).toEqual(["eslint(no-restricted-imports)"]);
  });

  it("button·input·select·textarea·table·h1~h3 을 직접 쓰면 실패한다", () => {
    expect(codes("apps/web/src/bad-elements.tsx")).toEqual(
      Array.from({ length: 8 }, () => "react(forbid-elements)"),
    );
  });

  it("공용 컴포넌트와 배치 토큰(space·size)은 통과한다", () => {
    expect(codes("apps/web/src/good.tsx")).toEqual([]);
  });

  it("시험 파일, /ds 토큰 목록, packages/ui 는 막지 않는다", () => {
    expect(codes("apps/web/src/good.test.tsx")).toEqual([]);
    expect(codes("apps/web/src/ds/catalog.tsx")).toEqual([]);
    expect(codes("packages/ui/src/inside.tsx")).toEqual([]);
  });
});
