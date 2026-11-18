import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const STATUS_COLOR_FAMILIES = ["answer", "check", "problem", "progress", "merged", "idle"];
const STATUS_COLOR_TOKEN = new RegExp(`^(?:${STATUS_COLOR_FAMILIES.join("|")})(?:Soft|Border)?$`);

const STATUS_STYLES: Record<string, string[]> = {
  statusIconProblem: ["problem", "problemSoft"],
};

interface StatusColorUse {
  token: string;
  style: string | undefined;
}

const STYLE_BLOCK_START = /^const \w+ = stylex\.create\(\{$/;
const STYLE_KEY = /^ {2}(\w+):/;
const STATUS_COLOR_USE = /\bcolors\.(\w+)\b/g;

function statusColorUses(file: string): StatusColorUse[] {
  const uses: StatusColorUse[] = [];
  let inStyleBlock = false;
  let style: string | undefined;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (STYLE_BLOCK_START.test(line)) {
      inStyleBlock = true;
      style = undefined;
      continue;
    }
    if (inStyleBlock && line === "});") {
      inStyleBlock = false;
      style = undefined;
      continue;
    }
    const key = inStyleBlock ? STYLE_KEY.exec(line) : null;
    if (key !== null) style = key[1];
    for (const [, token] of line.matchAll(STATUS_COLOR_USE)) {
      if (token !== undefined && STATUS_COLOR_TOKEN.test(token)) uses.push({ token, style });
    }
  }
  return uses;
}

describe("데스크톱 렌더러의 상태 색", () => {
  const renderer = import.meta.dirname;
  const files = readdirSync(renderer)
    .filter((name) => name.endsWith(".tsx") && !name.includes(".test."))
    .map((name) => join(renderer, name));

  it("렌더러의 tsx 파일을 모두 읽는다", () => {
    expect(files.map((file) => file.slice(renderer.length + 1))).toContain("app.tsx");
  });

  it("상태 색 토큰은 상태를 보이는 스타일에서만 쓴다", () => {
    const misplaced = files.flatMap((file) =>
      statusColorUses(file)
        .filter(
          ({ token, style }) => !(style !== undefined && STATUS_STYLES[style]?.includes(token)),
        )
        .map(({ token, style }) => `${file}: colors.${token} in ${style ?? "(no style)"}`),
    );
    expect(misplaced).toEqual([]);
  });

  it("문제 아이콘은 빨강(problem)으로 칠한다", () => {
    const uses = statusColorUses(join(renderer, "app.tsx"));
    expect(
      uses.filter(({ style }) => style === "statusIconProblem").map(({ token }) => token),
    ).toEqual(expect.arrayContaining(["problem", "problemSoft"]));
  });

  it("안내 줄과 다시 확인하는 점은 Human Check 청록을 쓰지 않는다", () => {
    const uses = statusColorUses(join(renderer, "app.tsx"));
    expect(uses.filter(({ style }) => style === "rowNote" || style === "liveDot")).toEqual([]);
  });
});
