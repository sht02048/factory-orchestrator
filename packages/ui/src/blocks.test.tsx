import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AppFrame,
  Button,
  Chip,
  CodeBlock,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  DataTableRowHeader,
  Input,
  OutcomeBar,
  RadioOption,
  RemovableChip,
  StepNav,
  StepNavItem,
  TEXT_TONES,
  Text,
  TextLink,
  Textarea,
  Tooltip,
  textStyles,
} from "./index";
import * as stylex from "@stylexjs/stylex";

const noop = () => {};

describe("Text tone·속성(티켓 0074)", () => {
  it("tone 마다 다른 색 클래스를 더하고, 역할 클래스는 그대로 둔다", () => {
    const base = stylex.props(textStyles("ui")).className ?? "";
    const toned = TEXT_TONES.map((tone) => stylex.props(textStyles("ui", tone)).className ?? "");
    expect(new Set(toned).size).toBe(TEXT_TONES.length);
    for (const classes of toned) expect(classes).not.toBe(base);
  });

  it("id·role·tabIndex 를 넘기고 결과 문장은 포커스를 받을 수 있다", () => {
    const html = renderToString(
      <Text variant="meta" as="p" id="r" role="status" tabIndex={-1}>
        보냈어요
      </Text>,
    );
    expect(html).toMatch(/^<p id="r" role="status" tabindex="-1" class="[^"]+">보냈어요<\/p>$/);
  });
});

describe("Button aria 속성(티켓 0067·0074)", () => {
  it("aria-pressed·aria-describedby 를 넘긴다", () => {
    const html = renderToString(
      <Button aria-pressed aria-describedby="hint">
        보기
      </Button>,
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-describedby="hint"');
  });

  it("aria-disabled 는 못 쓰는 모양이지만 disabled 를 걸지 않아 포커스가 남는다", () => {
    const off = renderToString(
      <Button variant="ghost" aria-disabled>
        새로 고침
      </Button>,
    );
    const on = renderToString(<Button variant="ghost">새로 고침</Button>);
    expect(off).toContain('aria-disabled="true"');
    expect(off).not.toMatch(/\sdisabled=""/);
    expect(off.replace(/ aria-disabled="true"/, "")).not.toBe(on);
  });
});

describe("입력(티켓 0074)", () => {
  it("Input 은 aria-label 로 이름을 받는다", () => {
    expect(renderToString(<Input aria-label="찾기" />)).toContain('aria-label="찾기"');
  });

  it("Textarea 는 이름과 설명 연결을 넘기는 textarea 다", () => {
    const html = renderToString(
      <Textarea aria-label="직접 쓰기" aria-describedby="h" value="" onValueChange={noop} />,
    );
    expect(html).toMatch(/^<textarea aria-label="직접 쓰기" aria-describedby="h"/);
  });

  it("RadioOption 은 라벨 안에 radio 와 글을 둔다", () => {
    const html = renderToString(
      <RadioOption name="q" value="0" checked={false} onCheck={noop}>
        30초 고정
      </RadioOption>,
    );
    expect(html).toMatch(
      /^<label[^>]*><input type="radio"[^>]*name="q" value="0"[^>]*\/><span[^>]*>30초 고정<\/span><\/label>$/,
    );
  });
});

describe("칩·링크·코드(티켓 0074)", () => {
  it("RemovableChip 은 지우기 이름을 가진 보조 버튼이고 Chip 은 글 표시다", () => {
    const html = renderToString(
      <RemovableChip removeLabel="러너 조건 지우기" onRemove={noop}>
        러너: a
      </RemovableChip>,
    );
    expect(html).toMatch(/^<button[^>]*aria-label="러너 조건 지우기"[^>]*data-variant="secondary"/);
    expect(html).toContain(">러너: a<svg");
    expect(renderToString(<Chip strong>필수</Chip>)).toMatch(/^<span class="[^"]+">필수<\/span>$/);
  });

  it("TextLink 는 바깥 링크면 새 탭으로 연다", () => {
    expect(
      renderToString(
        <TextLink href="https://example.com" external>
          PR
        </TextLink>,
      ),
    ).toContain('target="_blank" rel="noreferrer"');
  });

  it("CodeBlock scroll 은 이름 있는 영역이라 키보드로 스크롤할 수 있다", () => {
    const html = renderToString(
      <CodeBlock scroll label="로그">
        a
      </CodeBlock>,
    );
    expect(html).toMatch(/^<pre tabindex="0" role="region" aria-label="로그"/);
    expect(renderToString(<CodeBlock>a</CodeBlock>)).toMatch(/^<pre class="[^"]+">a<\/pre>$/);
  });
});

describe("DataTable·차트·단계(티켓 0074)", () => {
  it("DataTable 은 열·행 머리를 scope 로 잇고 framed 이면 카드 상자에 담는다", () => {
    const html = renderToString(
      <DataTable label="매핑" framed>
        <DataTableHead>
          <DataTableHeader>이름</DataTableHeader>
        </DataTableHead>
        <DataTableBody>
          <DataTableRow>
            <DataTableRowHeader>Web</DataTableRowHeader>
            <DataTableCell>1</DataTableCell>
          </DataTableRow>
        </DataTableBody>
      </DataTable>,
    );
    expect(html).toMatch(/^<div[^>]*><table aria-label="매핑"/);
    expect(html).toMatch(/<th scope="col"[^>]*>이름<\/th>/);
    expect(html).toMatch(/<th scope="row"[^>]*>Web<\/th>/);
  });

  it("OutcomeBar 는 이름 있는 그림이고 0 인 결과는 그리지 않는다", () => {
    const html = renderToString(
      <OutcomeBar
        label="Merged 2"
        segments={[
          { tone: "merged", value: 2 },
          { tone: "failed", value: 0 },
        ]}
      />,
    );
    expect(html).toMatch(/^<span role="img" aria-label="Merged 2"/);
    expect(html.match(/flex-grow/g)).toHaveLength(1);
  });

  it("StepNavItem 은 지금 단계를 aria-current 로, 끝난 단계는 화면 읽기 글로 알린다", () => {
    const html = renderToString(
      <StepNav label="단계" title="시작하기">
        <StepNavItem number={1} name="Tracker" state="done" doneLabel="완료" onSelect={noop} />
        <StepNavItem number={2} name="GitHub" state="current" doneLabel="완료" />
      </StepNav>,
    );
    expect(html).toMatch(/^<nav aria-label="단계"/);
    expect(html).toMatch(/<button type="button"[^>]*>.*Tracker.*완료.*<\/button>/);
    expect(html).toMatch(/aria-current="step"[^>]*>.*GitHub/);
  });

  it("AppFrame 은 레일과 본문을 나눈다", () => {
    const html = renderToString(<AppFrame rail="레일">본문</AppFrame>);
    expect(html).toMatch(/<aside[^>]*>레일<\/aside><main[^>]*>본문<\/main>/);
  });
});

describe("Tooltip action 트리거(0062 후속)", () => {
  it("action 을 주면 트리거 자신이 버튼 모양이라 버튼 안에 버튼이 생기지 않는다", () => {
    const html = renderToString(
      <Tooltip
        content="다시 찾기"
        labelsTrigger
        action={{ variant: "ghost", busy: true, onClick: noop }}
      >
        <svg aria-hidden="true" />
      </Tooltip>,
    );
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('data-variant="ghost"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toMatch(/<button[^>]*aria-label(ledby)?="[^"]+"/);
  });
});
