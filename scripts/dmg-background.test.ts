import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  BACKGROUND_PNG,
  BACKGROUND_PNG_2X,
  BACKGROUND_SIZE,
  BACKGROUND_SVG,
  pngSize,
} from "./dmg-background.ts";

describe("dmg 배경 그림", () => {
  it("원본 SVG 는 창과 같은 540×380 이다", () => {
    const svg = readFileSync(BACKGROUND_SVG, "utf8");
    expect(svg).toContain('viewBox="0 0 540 380"');
    expect(svg).toContain("Drag Ganger to Applications");
  });

  it("PNG 는 1배와 2배 크기다", () => {
    expect(pngSize(readFileSync(BACKGROUND_PNG))).toEqual(BACKGROUND_SIZE);
    expect(pngSize(readFileSync(BACKGROUND_PNG_2X))).toEqual({
      width: BACKGROUND_SIZE.width * 2,
      height: BACKGROUND_SIZE.height * 2,
    });
  });

  it("PNG 가 아니면 크기를 읽지 않고 멈춘다", () => {
    expect(() => pngSize(new TextEncoder().encode("not a png at all, really"))).toThrow(
      "Not a PNG file",
    );
  });
});
