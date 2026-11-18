import { readdirSync, readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MASCOT_BODY, MASCOT_BRIM, WHISTLE_BODY, WORRIED_BROWS } from "./components/brand";
import { GangerMark, MASCOT_MOODS, Mascot, MascotMessage } from "./index";

const brandDir = new URL("../brand/", import.meta.url);
const sourceFile = (name: string) => readFileSync(new URL(name, brandDir), "utf8");

describe("호루라기 기호", () => {
  it("이름을 주면 그림으로 읽히고, 주지 않으면 화면 읽기에서 숨는다", () => {
    expect(renderToString(<GangerMark label="Factory Orchestrator" />)).toMatch(
      /^<svg[^>]*role="img"[^>]*aria-label="Factory Orchestrator"/,
    );
    expect(renderToString(<GangerMark />)).toMatch(/^<svg[^>]*aria-hidden="true"/);
  });

  it("한 색판은 취구도 몸통과 같은 색이고, 브랜드판만 취구를 노랑으로 칠한다", () => {
    const fills = (html: string) => [...html.matchAll(/<(?:path|rect)[^>]*class="([^"]+)"/g)];
    const [monoBody, monoMouthpiece] = fills(renderToString(<GangerMark tone="mono" />));
    const [brandBody, brandMouthpiece] = fills(renderToString(<GangerMark tone="brand" />));
    expect(monoMouthpiece?.[1]).toEqual(monoBody?.[1]);
    expect(brandBody?.[1]).toEqual(monoBody?.[1]);
    expect(brandMouthpiece?.[1]).not.toEqual(brandBody?.[1]);
  });
});

describe("반장 마스코트", () => {
  it("표정 넷 모두 장식이라 화면 읽기에서 숨는다", () => {
    for (const mood of MASCOT_MOODS) {
      const html = renderToString(<Mascot mood={mood} />);
      expect(html).toMatch(/^<svg[^>]*aria-hidden="true"/);
      expect(html).toContain(`data-mascot="${mood}"`);
      expect(html).not.toMatch(/role="img"|aria-label|<title/);
    }
  });

  it("표정은 얼굴만 바뀌고 몸과 모자는 같다", () => {
    const faces = MASCOT_MOODS.map((mood) => renderToString(<Mascot mood={mood} />));
    expect(new Set(faces).size).toBe(MASCOT_MOODS.length);
    for (const html of faces) {
      expect(html).toContain(`d="${MASCOT_BODY}"`);
      expect(html).toContain(`d="${MASCOT_BRIM}"`);
    }
  });

  it("걱정 표정의 눈썹은 바깥이 낮고 안쪽이 높아 화난 표정으로 읽히지 않는다", () => {
    const brows = [...WORRIED_BROWS.matchAll(/M([\d.]+) ([\d.]+)l(-?[\d.]+)(-?[\d.]+)/g)].map(
      ([, x, y, dx, dy]) => ({
        outer: { x: Number(x), y: Number(y) },
        inner: { x: Number(x) + Number(dx), y: Number(y) + Number(dy) },
      }),
    );
    expect(brows).toHaveLength(2);
    for (const { outer, inner } of brows) {
      expect(Math.abs(inner.x - 50)).toBeLessThan(Math.abs(outer.x - 50));
      expect(inner.y).toBeLessThan(outer.y);
    }
    expect(renderToString(<Mascot mood="worried" />)).toContain(`d="${WORRIED_BROWS}"`);
    expect(sourceFile("mascot-worried.svg")).toContain(`d="${WORRIED_BROWS}"`);
  });

  it("MascotMessage 는 마스코트를 숨기고 글만 읽힌다", () => {
    const html = renderToString(
      <MascotMessage mood="resting">
        <p>처리할 일이 없어요</p>
      </MascotMessage>,
    );
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-mascot="resting"/);
    expect(html).toContain("<p>처리할 일이 없어요</p>");
  });
});

describe("브랜드 원본 SVG", () => {
  const files = readdirSync(brandDir).filter((name) => name.endsWith(".svg"));

  it("기호·한 색판·파비콘 전용판·워드마크·조합 둘·표정 넷·앱 아이콘을 모두 둔다", () => {
    expect(files.toSorted()).toEqual(
      [
        "app-icon.svg",
        "logo-horizontal.svg",
        "logo-vertical.svg",
        "mark-favicon.svg",
        "mark-mono.svg",
        "mark.svg",
        ...MASCOT_MOODS.map((mood) => `mascot-${mood}.svg`),
        "wordmark.svg",
      ].toSorted(),
    );
  });

  it("컴포넌트와 같은 기하로 그린다", () => {
    for (const name of ["mark.svg", "mark-mono.svg", "logo-horizontal.svg", "app-icon.svg"]) {
      expect(sourceFile(name)).toContain(WHISTLE_BODY);
    }
    for (const mood of MASCOT_MOODS) {
      const svg = sourceFile(`mascot-${mood}.svg`);
      expect(svg).toContain(MASCOT_BODY);
      expect(svg).toContain(MASCOT_BRIM);
    }
  });

  it("글꼴 없이 보이도록 글자를 패스로 넣고 주석을 두지 않는다", () => {
    for (const name of files) {
      const svg = sourceFile(name);
      expect(svg).not.toMatch(/<text|<!--|@font-face/);
    }
    expect(sourceFile("OFL-Manrope.txt")).toContain("SIL Open Font License");
  });
});
