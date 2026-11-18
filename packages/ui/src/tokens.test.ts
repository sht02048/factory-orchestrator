import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { colors, motion, radius, space } from "./tokens.stylex";

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

describe("브랜드 그림 토큰(티켓 0077)", () => {
  const entries = block("brand");
  const value = (key: string): string => entries.find(([k]) => k === key)?.[1] ?? "";

  it("화면 색(colors)과 따로 두고 OKLCH 로 쓴다", () => {
    expect(entries.map(([key]) => key)).toEqual(["yellow", "ink", "paper", "body", "eye", "snore"]);
    expect(entries.filter(([, v]) => !OKLCH.test(v))).toEqual([]);
    expect(block("colors").map(([, v]) => v)).not.toContain(value("yellow"));
  });

  it("채도 있는 색은 Ganger Yellow 하나다(ADR 0010 5번 브랜드 예외)", () => {
    expect(value("yellow")).toBe("oklch(0.84 0.15 75)");
    expect(entries.filter(([, v]) => parts(v).c > 0.03).map(([key]) => key)).toEqual(["yellow"]);
  });

  it("Ink 와 Paper 는 운영자가 고른 값이다", () => {
    expect(value("ink")).toBe("oklch(0.14 0 0)");
    expect(value("paper")).toBe("oklch(0.97 0.003 85)");
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

describe("글자 토큰(티켓 0073)", () => {
  it("기존 크기는 그대로 두고 display 26, heading 20, subheading 15 를 더한다", () => {
    expect(Object.fromEntries(block("fontSize"))).toEqual({
      display: "26px",
      page: "22px",
      heading: "20px",
      panel: "17px",
      subheading: "15px",
      body: "14px",
      ui: "13px",
      small: "12px",
      label: "11px",
      input: "16px",
    });
  });

  it("굵기·줄 높이·자간의 기존 값을 바꾸지 않는다", () => {
    expect(Object.fromEntries(block("fontWeight"))).toEqual({
      regular: "400",
      medium: "500",
      semibold: "600",
    });
    expect(Object.fromEntries(block("lineHeight"))).toEqual({
      tight: "1.2",
      snug: "1.35",
      normal: "1.5",
      relaxed: "1.55",
    });
    expect(Object.fromEntries(block("letterSpacing"))).toEqual({
      display: "-0.015em",
      page: "-0.01em",
      panel: "-0.005em",
      label: "0.04em",
    });
  });
});
