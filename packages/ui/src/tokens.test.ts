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

function parts(value: string): { l: number; c: number; h: number } {
  const groups = OKLCH.exec(value)?.groups;
  return { l: Number(groups?.["l"]), c: Number(groups?.["c"]), h: Number(groups?.["h"]) };
}

// 상태 색의 뜻(ADR 0010 5번). 채도 있는 색은 이 다섯 뜻과 포인트 파랑(accent)에만 있다.
const MEANINGS = ["answer", "check", "problem", "progress", "merged"] as const;
const CHROMATIC_GROUP = /^(accent|answer|check|problem|progress|merged)/;

describe("색 토큰", () => {
  const entries = block("colors");
  const value = (key: string): string => entries.find(([k]) => k === key)?.[1] ?? "";

  it("모두 OKLCH 로 쓴다", () => {
    expect(entries.length).toBeGreaterThan(20);
    const notOklch = entries.filter(([, v]) => !OKLCH.test(v)).map(([key]) => key);
    expect(notOklch).toEqual([]);
  });

  it("채도 있는 색은 포인트와 상태 색 다섯 뜻에만 쓴다(ADR 0010 5번)", () => {
    const chromatic = entries.filter(([, v]) => parts(v).c > 0.03).map(([key]) => key);
    expect(chromatic.filter((key) => !CHROMATIC_GROUP.test(key))).toEqual([]);
    expect(chromatic).toEqual(expect.arrayContaining(["accent", ...MEANINGS]));
  });

  it("상태 색 여섯 뜻이 글·점 색과 알약 바탕(Soft)을 갖는다", () => {
    const keys = [...MEANINGS, "idle"].flatMap((meaning) => [meaning, `${meaning}Soft`]);
    expect(keys.filter((key) => !OKLCH.test(value(key)))).toEqual([]);
  });

  it("회색(대기·멈춤)은 무채색이다", () => {
    expect(parts(value("idle")).c).toBeLessThanOrEqual(0.03);
    expect(parts(value("idleSoft")).c).toBeLessThanOrEqual(0.03);
  });

  it("상태 색은 색상(hue)이 서로 멀어 헷갈리지 않는다", () => {
    // 보라·노랑·빨강·초록·파랑. Human Check(노랑)와 Failed(빨강)를 헷갈렸던 것이 ADR 0010 의 출발이다.
    const hues = MEANINGS.map((m) => parts(value(m)).h);
    for (const [i, a] of hues.entries()) {
      for (const b of hues.slice(i + 1)) {
        const distance = Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
        expect(distance).toBeGreaterThanOrEqual(40);
      }
    }
  });

  it("알약의 파랑(merged)은 주 버튼의 파랑(accent)과 밝기가 달라 모양 말고도 갈린다", () => {
    expect(Math.abs(parts(value("merged")).l - parts(value("accent")).l)).toBeGreaterThan(0.15);
  });

  it("CSS 변수로 컴파일된다", () => {
    expect(String(colors.bgCanvas)).toMatch(/^var\(--/);
    expect(String(space.s4)).toMatch(/^var\(--/);
    expect(String(radius.card)).toMatch(/^var\(--/);
    expect(String(motion.easeOut)).toMatch(/^var\(--/);
  });
});

describe("둥글기 토큰", () => {
  it("카드 12, 버튼·행·입력 8, 알약 6 이다(ADR 0010 10번)", () => {
    expect(Object.fromEntries(block("radius"))).toEqual({
      card: "12px",
      control: "8px",
      pill: "6px",
      full: "9999px",
    });
  });
});

describe("간격 토큰", () => {
  it("4px 단위이고 2px·6px 만 예외다", () => {
    const offGrid = block("space").filter(([, v]) => {
      const px = Number(v.replace("px", ""));
      return !(px % 4 === 0 || px === 2 || px === 6);
    });
    expect(block("space").length).toBeGreaterThan(5);
    expect(offGrid).toEqual([]);
  });
});
