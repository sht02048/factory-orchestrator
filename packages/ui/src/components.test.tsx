import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  Button,
  Card,
  Checkbox,
  DefinitionItem,
  DefinitionList,
  Dialog,
  DialogClose,
  Field,
  Input,
  Menu,
  MenuItem,
  PILL_STATUSES,
  Popover,
  Row,
  Select,
  SplitView,
  StatusPill,
  Tab,
  Table,
  TableCell,
  TableRow,
  TableRows,
  Tabs,
  Text,
  Tooltip,
  statusTone,
  type PillStatus,
  type StatusTone,
} from "./index";

const noop = () => {};

describe("서버 렌더", () => {
  it("Button 은 변형마다 다른 클래스를 갖고 disabled 를 넘긴다", () => {
    const html = (variant?: "primary" | "secondary" | "danger" | "ghost") =>
      renderToString(<Button {...(variant === undefined ? {} : { variant })}>시작</Button>);
    expect(html("primary")).toContain('type="button"');
    expect(html()).toEqual(html("secondary"));
    const classes = new Set(["primary", "secondary", "danger", "ghost"] as const);
    expect(new Set([...classes].map((v) => html(v))).size).toBe(4);
    expect(renderToString(<Button disabled>시작</Button>)).toContain("disabled");
  });

  it("StatusPill 은 상태 값마다 ADR 0010 5번의 색을 고른다", () => {
    const expected: Record<StatusTone, PillStatus[]> = {
      answer: ["waiting-for-input", "question", "permission"],
      check: ["human-check"],
      problem: ["disconnected", "failed", "offline", "runner-issue"],
      progress: ["running", "online"],
      merged: ["merged"],
      idle: ["queued", "canceled"],
    };
    const actual: Record<StatusTone, PillStatus[]> = {
      answer: [],
      check: [],
      problem: [],
      progress: [],
      merged: [],
      idle: [],
    };
    for (const status of PILL_STATUSES) actual[statusTone(status)].push(status);
    expect(actual).toEqual(expected);
  });

  it("StatusPill 은 점과 이름을 함께 그리고, 점은 스크린 리더에서 숨긴다", () => {
    const html = renderToString(<StatusPill status="human-check">Human Check</StatusPill>);
    expect(html).toContain("Human Check");
    expect(html).toContain('data-tone="check"');
    expect(html).toContain('aria-hidden="true"');
    const failed = renderToString(<StatusPill status="failed">Human Check</StatusPill>);
    expect(failed.replace(/data-[a-z]+="[^"]*"/g, "")).not.toEqual(
      html.replace(/data-[a-z]+="[^"]*"/g, ""),
    );
  });

  it("Card 는 이름이 있으면 구역으로, Row 는 앞·뒤 칸을 그린다", () => {
    expect(renderToString(<Card>내용</Card>)).toMatch(/^<div/);
    expect(renderToString(<Card label="손댈 일">내용</Card>)).toMatch(
      /^<section aria-label="손댈 일"/,
    );
    const row = renderToString(
      <Row leading={<StatusPill status="running">Running</StatusPill>} trailing="10:45">
        시작했어요
      </Row>,
    );
    expect(row).toContain("Running");
    expect(row).toContain("시작했어요");
    expect(row).toContain("10:45");
  });

  it("Row 는 href 를 주면 행 전체가 링크이고, 누를 수 없는 행은 hover 면을 끈다(티켓 0050)", () => {
    const link = renderToString(<Row href="/runs/run-1?ws=ws-1">시작했어요</Row>);
    expect(link).toMatch(/^<a href="\/runs\/run-1\?ws=ws-1"/);
    const classOf = (html: string) => /class="([^"]*)"/.exec(html)?.[1] ?? "";
    const plain = renderToString(<Row interactive={false}>시작했어요</Row>);
    const hover = renderToString(<Row>시작했어요</Row>);
    expect(plain).toMatch(/^<div/);
    expect(classOf(plain)).not.toEqual(classOf(hover));
  });

  it("Text 는 변형에 맞는 기본 요소를 쓴다", () => {
    expect(renderToString(<Text variant="page">Runs</Text>)).toMatch(/^<h1/);
    expect(renderToString(<Text variant="panel">제목</Text>)).toMatch(/^<h2/);
    expect(renderToString(<Text variant="meta">ACME-1</Text>)).toMatch(/^<span/);
    expect(
      renderToString(
        <Text variant="page" as="p">
          Runs
        </Text>,
      ),
    ).toMatch(/^<p/);
  });

  it("Table 행은 listbox 의 option 이고 고른 행이 aria-selected 다", () => {
    const html = renderToString(
      <Table columns="minmax(0, 1fr) 80px">
        <TableRows label="런 목록" value="b" onValueChange={noop}>
          <TableRow value="a" label="첫째">
            <TableCell>첫째</TableCell>
          </TableRow>
          <TableRow value="b" label="둘째">
            <TableCell align="end" numeric>
              둘째
            </TableCell>
          </TableRow>
        </TableRows>
      </Table>,
    );
    expect(html).toContain('role="listbox"');
    expect(html).toContain('aria-label="런 목록"');
    expect(html.match(/role="option"/g)).toHaveLength(2);
    expect(html).toMatch(/aria-selected="true"[^>]*>.*둘째|둘째.*aria-selected="true"/s);
    expect(html).toContain("grid-template-columns:minmax(0, 1fr) 80px");
  });

  it("Tabs 는 고른 탭을 aria-selected 로 표시하고 개수를 붙인다", () => {
    const html = renderToString(
      <Tabs value="todo" onValueChange={noop} label="상태로 거르기">
        <Tab value="all" count={42}>
          전체
        </Tab>
        <Tab value="todo" count={3} attention>
          손댈 일
        </Tab>
      </Tabs>,
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="상태로 거르기"');
    expect(html).toMatch(/aria-selected="true"[^>]*>손댈 일/);
    expect(html).toContain(">42<");
  });

  it("Tabs chips 는 같은 탭 목록을 칩 모양으로 그린다", () => {
    const html = renderToString(
      <Tabs value="all" onValueChange={noop} label="상태로 거르기" variant="chips">
        <Tab value="all" count={52}>
          전체
        </Tab>
        <Tab value="todo" count={4} attention>
          손댈 일
        </Tab>
      </Tabs>,
    );
    const underline = renderToString(
      <Tabs value="all" onValueChange={noop} label="상태로 거르기">
        <Tab value="all" count={52}>
          전체
        </Tab>
      </Tabs>,
    );
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/aria-selected="true"[^>]*>전체/);
    expect(html).toContain(">4<");
    const listClass = (h: string) =>
      /role="tablist"[^>]*class="([^"]+)"|class="([^"]+)"[^>]*role="tablist"/.exec(h);
    const chips = listClass(html);
    const under = listClass(underline);
    expect(chips?.[1] ?? chips?.[2]).not.toBe(under?.[1] ?? under?.[2]);
  });

  it("Field 의 오류는 입력을 invalid 로 만들고 라벨을 잇는다", () => {
    const html = renderToString(
      <Field label="Orca 경로" error="찾지 못했어요">
        <Input name="orca" defaultValue="/opt/orca" mono />
      </Field>,
    );
    expect(html).toContain("Orca 경로");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("찾지 못했어요");
    const label = /<label[^>]*for="([^"]+)"/.exec(html)?.[1];
    expect(label).toBeDefined();
    expect(html).toContain(`id="${label}"`);
  });

  it("Input 은 data 속성과 inputMode 를 입력 요소에 넘긴다(티켓 0055)", () => {
    const html = renderToString(
      <Field label="API 키">
        <Input
          name="apiKey"
          type="password"
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          inputMode="numeric"
        />
      </Field>,
    );
    const input = /<input[^>]*>/.exec(html)?.[0] ?? "";
    expect(input).toContain('data-1p-ignore="true"');
    expect(input).toContain('data-lpignore="true"');
    expect(input).toContain('inputMode="numeric"');
    expect(input).toContain('autoComplete="off"');
  });

  it("버튼과 버튼 모양 트리거는 data-variant 로 변형을 드러낸다(주 버튼 하나 시험, ADR 0010 6번)", () => {
    const html = renderToString(
      <>
        <Button variant="primary">시작</Button>
        <Button>보기</Button>
        <Button variant="danger">거절</Button>
        <Dialog
          trigger="지우기"
          triggerVariant="danger"
          title="지울까요?"
          actions={<DialogClose>취소</DialogClose>}
        />
      </>,
    );
    expect([...html.matchAll(/data-variant="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "primary",
      "secondary",
      "danger",
      "danger",
    ]);
  });

  it("레일 Menu 는 펼침 화살표 없이 트리거 내용만 그린다", () => {
    const rail = renderToString(
      <Menu variant="rail" label="Workspace 바꾸기" trigger="Acme">
        <MenuItem value="a">A</MenuItem>
      </Menu>,
    );
    const field = renderToString(
      <Menu trigger="Acme">
        <MenuItem value="a">A</MenuItem>
      </Menu>,
    );
    expect(rail).toContain('aria-label="Workspace 바꾸기"');
    expect(rail).toContain("Acme");
    expect(rail).not.toContain("<svg");
    expect(field).toContain("<svg");
  });

  it("팝업(Menu·Select·Dialog·Tooltip)은 닫힌 채 트리거만 보인다", () => {
    const html = renderToString(
      <>
        <Menu trigger="Workspace">
          <MenuItem value="a">A</MenuItem>
        </Menu>
        <Select
          value={null}
          onValueChange={noop}
          placeholder="골라 주세요"
          options={[{ value: "a", label: "A" }]}
        />
        <Dialog trigger="지우기" title="지울까요?" actions={<DialogClose>취소</DialogClose>} />
        <Tooltip content="힌트">capacity</Tooltip>
      </>,
    );
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("골라 주세요");
    expect(html).toContain("지우기");
    expect(html).not.toContain("지울까요?");
  });

  it("Popover 는 닫힌 채 버튼 모양 트리거만 보이고, 열면 제목과 닫기 버튼을 그린다", () => {
    const closed = renderToString(
      <Popover trigger="답하기" title="질문" closeLabel="닫기" open={false} onOpenChange={noop}>
        <p>내용</p>
      </Popover>,
    );
    expect(closed).toMatch(/<button[^>]*data-variant="secondary"[^>]*>답하기<\/button>/);
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain("내용");

    const danger = renderToString(
      <Popover
        trigger="거절하기"
        triggerVariant="danger"
        title="권한"
        closeLabel="닫기"
        open={false}
        onOpenChange={noop}
      >
        <p>내용</p>
      </Popover>,
    );
    expect(danger).toContain('data-variant="danger"');
  });

  it("Checkbox 는 라벨 안에 체크 상태와 설명을 갖고, 고를 수 없으면 disabled 를 넘긴다", () => {
    const html = renderToString(
      <>
        <Checkbox label="Web" checked onCheckedChange={noop} />
        <Checkbox
          label="API"
          description="다른 Workspace에 있어요"
          checked={false}
          disabled
          onCheckedChange={noop}
        />
      </>,
    );
    const [web, api] = html.split("API");
    expect(web).toMatch(/<label[^>]*>.*role="checkbox"/s);
    expect(web).toContain('aria-checked="true"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain("다른 Workspace에 있어요");
    expect(api).toBeDefined();
    expect(html.match(/disabled=""/g)?.length ?? 0).toBeGreaterThan(0);
  });

  it("Select 는 aria-label 을 트리거에 붙인다", () => {
    const html = renderToString(
      <Select
        aria-label="Web의 에이전트"
        value={null}
        onValueChange={noop}
        options={[{ value: "a", label: "A" }]}
      />,
    );
    expect(html).toContain('aria-label="Web의 에이전트"');
  });

  it("DefinitionList 는 dt·dd 짝을 만든다", () => {
    const html = renderToString(
      <DefinitionList>
        <DefinitionItem label="러너">runner-a</DefinitionItem>
        <DefinitionItem label="PR" empty>
          없음
        </DefinitionItem>
      </DefinitionList>,
    );
    expect(html.match(/<dt/g)).toHaveLength(2);
    expect(html.match(/<dd/g)).toHaveLength(2);
  });

  it("SplitView editor 는 목록 변형과 다른 열 배치를 쓴다", () => {
    const list = renderToString(<SplitView list="목록" panel="패널" />);
    const editor = renderToString(<SplitView variant="editor" list="목록" panel="패널" />);
    expect(editor).toContain("목록");
    expect(editor).toContain("패널");
    expect(editor).not.toEqual(list);
  });
});
