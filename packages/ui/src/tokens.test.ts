import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { colors, motion, radius, space } from "./tokens.stylex";

// 토큰 값은 컴파일되면 CSS 변수 참조가 되므로, 원본 값은 소스에서 읽는다.
const source = readFileSync(new URL("./tokens.stylex.ts", import.meta.url), "utf8");

function block(name: string): Array<[string, string]> {
  const start = source.indexOf(`export const ${name} = stylex.defineVars({`);
  const end = source.indexOf("\n});", start);
  const body = source.slice(start, end);
  return [...body.matchAll(/^\s+(\w+):\s*\n?\s*"([^"]+)",/gm)].map((m) => [m[1] ?? "", m[2] ?? ""]);
}

const OKLCH = /^oklch\((?<l>[\d.]+) (?<c>[\d.]+) (?<h>[\d.]+)(?: \/ [\d.]+)?\)$/;

describe("색 토큰", () => {
  const entries = block("colors");

  it("모두 OKLCH 로 쓴다", () => {
    expect(entries.length).toBeGreaterThan(20);
    const notOklch = entries.filter(([, value]) => !OKLCH.test(value)).map(([key]) => key);
    expect(notOklch).toEqual([]);
  });

  it("채도 있는 색은 포인트·Human Check·Failed·러너 Online 에만 쓴다(ADR 0007)", () => {
    const chromatic = entries
      .filter(([, value]) => Number(OKLCH.exec(value)?.groups?.["c"] ?? 0) > 0.03)
      .map(([key]) => key);
    expect(chromatic.filter((key) => !/^(accent|check|failed|online)/.test(key))).toEqual([]);
    expect(chromatic).toEqual(expect.arrayContaining(["accent", "check", "failed", "online"]));
  });

  it("CSS 변수로 컴파일된다", () => {
    expect(String(colors.bgCanvas)).toMatch(/^var\(--/);
    expect(String(space.s4)).toMatch(/^var\(--/);
    expect(String(radius.md)).toMatch(/^var\(--/);
    expect(String(motion.easeOut)).toMatch(/^var\(--/);
  });
});

describe("간격 토큰", () => {
  it("4px 단위이고 2px·6px 만 예외다", () => {
    const offGrid = block("space").filter(([, value]) => {
      const px = Number(value.replace("px", ""));
      return !(px % 4 === 0 || px === 2 || px === 6);
    });
    expect(block("space").length).toBeGreaterThan(5);
    expect(offGrid).toEqual([]);
  });
});
