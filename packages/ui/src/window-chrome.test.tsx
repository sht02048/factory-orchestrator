import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";

import {
  AppFrame,
  PageHeader,
  RailBrand,
  ScreenLayout,
  WindowChrome,
  WindowDragFrame,
  windowFrame,
} from "./index";

const tokens = readFileSync(new URL("./tokens.stylex.ts", import.meta.url), "utf8");

function token(name: string): string {
  return new RegExp(`\\n\\s+${name}:\\s*"([^"]+)"`).exec(tokens)?.[1] ?? "";
}

function inWindow(titleBarHidden: boolean, node: ReactNode): string {
  return renderToString(<WindowChrome titleBarHidden={titleBarHidden}>{node}</WindowChrome>);
}

function shell(): ReactNode {
  return (
    <AppFrame
      rail={
        <>
          <span>Workspace</span>
          <RailBrand>마크</RailBrand>
        </>
      }
    >
      <ScreenLayout
        header={
          <PageHeader
            lead={<a href="/runs">Runs</a>}
            title="Runners"
            subtitle="러너 3대 모두 문제가 없어요."
            actions={<a href="/runners/new">러너 추가</a>}
          />
        }
      >
        본문
      </ScreenLayout>
    </AppFrame>
  );
}

describe("앱 셸과 창 제목 표시줄(0113)", () => {
  it("웹 브라우저에서는 레일 위 빈 자리와 창 끌기 영역을 두지 않는다", () => {
    const html = inWindow(false, shell());
    expect(html).not.toContain("data-window-controls");
    expect(html).not.toContain('data-app-region="drag"');
    expect(html).toMatch(/<aside[^>]*><div[^>]*><span>Workspace<\/span>/);
  });

  it("문맥이 없으면 웹 브라우저로 본다", () => {
    expect(renderToString(<>{shell()}</>)).not.toContain('data-app-region="drag"');
  });

  it("제목 표시줄을 숨긴 데스크톱 앱에서는 레일 맨 위에 신호등 자리를 비우고 그 자리와 머리 줄을 창 끌기 영역으로 둔다", () => {
    const html = inWindow(true, shell());
    expect(html).toMatch(
      /<aside[^>]*><div aria-hidden="true" data-window-controls="true" data-app-region="drag"[^>]*><\/div><div[^>]*><span>Workspace<\/span>/,
    );
    expect(html).toMatch(/<header data-app-region="drag"/);
  });

  it("머리 줄 안의 링크·버튼과 요약 글은 끌기에서 빼 누르고 고를 수 있다", () => {
    const html = inWindow(true, shell());
    expect(html).toMatch(/<p data-app-region="no-drag"[^>]*>러너 3대 모두 문제가 없어요.<\/p>/);
    expect(html).toMatch(/<div data-app-region="no-drag"[^>]*><a href="\/runs">Runs<\/a><\/div>/);
    expect(html).toMatch(
      /<div data-app-region="no-drag"[^>]*><a href="\/runners\/new">러너 추가<\/a><\/div><\/header>/,
    );
  });

  it("제품 기호는 레일 맨 아래, Workspace 뒤에 온다", () => {
    const html = inWindow(false, shell());
    expect(html.indexOf("Workspace")).toBeLessThan(html.indexOf("data-rail-brand"));
  });

  it("레일 없는 화면은 제목 표시줄을 숨긴 창에서만 맨 위 끌기 줄을 두고, 내용은 그 아래에서만 스크롤한다", () => {
    expect(inWindow(false, <WindowDragFrame>내용</WindowDragFrame>)).toBe("내용");
    expect(inWindow(true, <WindowDragFrame>내용</WindowDragFrame>)).toMatch(
      /^<div[^>]*><div aria-hidden="true" data-app-region="drag"><\/div><div[^>]*>내용<\/div><\/div>$/,
    );
  });
});

describe("한 줄 머리(0113)", () => {
  it("제목(h1)과 요약 문장이 한 줄에 나란하고 행동은 그 오른쪽이다", () => {
    const html = inWindow(false, shell());
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(header).toMatch(
      /<div[^>]*><h1[^>]*>Runners<\/h1><p[^>]*>러너 3대 모두 문제가 없어요.<\/p><\/div><div[^>]*><a href="\/runners\/new">/,
    );
  });

  it("요약과 행동이 없으면 제목만 둔다", () => {
    const html = renderToString(<PageHeader title="Runs" />);
    expect(html).toMatch(/^<header[^>]*><div[^>]*><h1[^>]*>Runs<\/h1><\/div><\/header>$/);
  });

  it("ScreenLayout 은 머리 줄을 본문 위에 둔다", () => {
    const html = renderToString(
      <ScreenLayout header={<PageHeader title="Runs" />}>본문</ScreenLayout>,
    );
    expect(html).toMatch(/^<div[^>]*><header[^>]*>.*<\/header><div[^>]*>본문<\/div><\/div>$/);
  });
});

describe("창 틀 값(0113)", () => {
  it("창 바탕은 Ink(bgCanvas) 를 sRGB 로 옮긴 값이다", () => {
    const ink = /^oklch\(([\d.]+) 0 0\)$/.exec(token("bgCanvas"));
    const lightness = Number(ink?.[1]);
    const linear = lightness ** 3;
    const srgb = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
    const channel = Math.round(srgb * 255)
      .toString(16)
      .padStart(2, "0");
    expect(windowFrame.background).toBe(`#${channel.repeat(3)}`);
  });

  it("머리 줄 높이와 레일 폭은 토큰과 같다", () => {
    expect(token("titleBar")).toBe(`${windowFrame.titleBarHeight}px`);
    expect(token("railWidth")).toBe(`${windowFrame.railWidth}px`);
  });
});
