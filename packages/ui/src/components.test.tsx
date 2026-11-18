import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  Button,
  CapacityBar,
  Card,
  Checkbox,
  DefinitionItem,
  DefinitionList,
  Dialog,
  DialogClose,
  Field,
  GroupHeader,
  Input,
  Menu,
  MenuItem,
  PILL_STATUSES,
  Popover,
  ProblemCallout,
  Row,
  SURFACE_ROLES,
  Section,
  SegmentedTabs,
  Select,
  SplitView,
  StatTile,
  StatusDot,
  StatusPill,
  Tab,
  Table,
  TableCell,
  TableRow,
  TableRows,
  Tabs,
  TEXT_VARIANTS,
  Text,
  Tooltip,
  statusTone,
  surfaceStyles,
  textStyles,
  type PillStatus,
  type StatusTone,
  type TextVariant,
} from "./index";
import * as stylex from "@stylexjs/stylex";

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
    expect(renderToString(<Card label="To do">내용</Card>)).toMatch(/^<section aria-label="To do"/);
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
          To do
        </Tab>
      </Tabs>,
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="상태로 거르기"');
    expect(html).toMatch(/aria-selected="true"[^>]*>To do/);
    expect(html).toContain(">42<");
  });

  it("Tabs chips 는 같은 탭 목록을 칩 모양으로 그린다", () => {
    const html = renderToString(
      <Tabs value="all" onValueChange={noop} label="상태로 거르기" variant="chips">
        <Tab value="all" count={52}>
          전체
        </Tab>
        <Tab value="todo" count={4} attention>
          To do
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
    const labels = [...html.matchAll(/<label[^>]*>(.*?)<\/label>/gs)].map((m) => m[1] ?? "");
    expect(labels).toHaveLength(2);
    expect(labels[0]).toContain('role="checkbox"');
    expect(labels[0]).toContain('aria-checked="true"');
    expect(labels[1]).toContain('aria-checked="false"');
    expect(labels[1]).toContain('disabled=""');
    expect(labels[1]).not.toContain("다른 Workspace에 있어요");
    const describedBy = /aria-describedby="([^"]+)"/.exec(labels[1] ?? "")?.[1];
    expect(describedBy).toBeDefined();
    expect(html).toContain(`id="${describedBy}"`);
    expect(html).toMatch(new RegExp(`id="${describedBy}"[^>]*>다른 Workspace에 있어요<`));
    expect(labels[0]).not.toContain("aria-describedby");
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

const classOf = (html: string) => /class="([^"]*)"/.exec(html)?.[1] ?? "";
const classSet = (classes: string) => new Set(classes.split(" ").filter((c) => c !== ""));

describe("글자 역할(티켓 0073)", () => {
  const before = [
    ["page", "x1ghz6dp xxbnsim x1g8le32 x45ymtg x8zzex5 xvr1kxx x1w2vvpw"],
    ["panel", "x1ghz6dp xxbnsim x18oput8 x45ymtg x14efcu5 xh0io9k x1fzhlzt"],
    ["section", "x1ghz6dp xxbnsim xgg16it x45ymtg x1ro8lm6"],
    ["title", "x1ghz6dp xxbnsim xgg16it xbu08dq x1ro8lm6"],
    ["body", "x1ghz6dp x1ry0s1v xgg16it x10ct87k x1fzhlzt"],
    ["ui", "x1ghz6dp x1ry0s1v x1kcddvv x1ro8lm6"],
    ["meta", "x1ghz6dp x1o6ikt5 x1kcddvv x1ro8lm6"],
    ["label", "x1ghz6dp x1o6ikt5 xwu4aly xbu08dq x1ro8lm6"],
  ] as const satisfies ReadonlyArray<readonly [TextVariant, string]>;

  it("기존 변형은 0073 전과 같은 스타일(같은 원자 클래스)을 쓴다", () => {
    for (const [variant, classes] of before) {
      const html = renderToString(<Text variant={variant}>글</Text>);
      expect([variant, classSet(classOf(html))]).toEqual([variant, classSet(classes)]);
    }
  });

  it("새 역할 display·heading·subheading 은 기존 변형과 다른 스타일이고 알맞은 제목 요소를 쓴다", () => {
    const html = (variant: TextVariant) => renderToString(<Text variant={variant}>글</Text>);
    expect(html("display")).toMatch(/^<h2/);
    expect(html("heading")).toMatch(/^<h2/);
    expect(html("subheading")).toMatch(/^<h3/);
    const all = new Set(TEXT_VARIANTS.map((v) => classOf(html(v))));
    expect(all.size).toBe(TEXT_VARIANTS.length);
  });

  it("textStyles 는 Text 와 같은 스타일을 다른 요소에 입힌다", () => {
    for (const role of TEXT_VARIANTS) {
      const fromText = classOf(renderToString(<Text variant={role}>글</Text>));
      expect(stylex.props(textStyles(role)).className).toBe(fromText);
    }
  });
});

describe("면 역할(티켓 0073)", () => {
  it("Card 기본 면은 0073 전과 같은 스타일을 쓴다", () => {
    expect(classSet(classOf(renderToString(<Card>내용</Card>)))).toEqual(
      classSet("x78zum5 xdt5ytf x3ugt x1piab5x xxe3m9b xrjbj3k"),
    );
    expect(classSet(classOf(renderToString(<Card padding="compact">내용</Card>)))).toEqual(
      classSet("x78zum5 xdt5ytf xxe3m9b xrjbj3k xxhr3t x4fnp73"),
    );
  });

  it("면 역할 네 가지가 서로 다르고, Card surface 와 surfaceStyles 가 같은 면을 쓴다", () => {
    const cards = SURFACE_ROLES.map((surface) =>
      classOf(renderToString(<Card surface={surface}>내용</Card>)),
    );
    expect(new Set(cards).size).toBe(SURFACE_ROLES.length);
    for (const [index, surface] of SURFACE_ROLES.entries()) {
      const surfaceClasses = classSet(stylex.props(surfaceStyles(surface)).className ?? "");
      expect([...surfaceClasses].every((c) => classSet(cards[index] ?? "").has(c))).toBe(true);
    }
  });
});

describe("Section 제목 역할(티켓 0073)", () => {
  it("기본 Section 은 0073 전과 같은 마크업이다", () => {
    expect(
      renderToString(
        <Section title="T" count={2} note="n">
          c
        </Section>,
      ),
    ).toBe(
      '<section class="xdj266r x1h2wk5"><div class="x78zum5 x1pha0wt xd7inxn xa7h3ct"><h2 class="x1ghz6dp xxbnsim xgg16it x45ymtg">T</h2><span class="x1o6ikt5 xss6m8b">2</span><span class="xvc5jky x1o6ikt5 xwu4aly">n</span></div>c</section>',
    );
  });

  it("heading 은 h2, subheading 은 h3 이고 글자 역할 스타일을 쓴다", () => {
    const heading = renderToString(
      <Section title="To do" titleRole="heading" count={3}>
        c
      </Section>,
    );
    const subheading = renderToString(
      <Section title="Runners" titleRole="subheading">
        c
      </Section>,
    );
    expect(heading).toContain(
      `<h2 class="${stylex.props(textStyles("heading")).className}">To do</h2>`,
    );
    expect(subheading).toContain(
      `<h3 class="${stylex.props(textStyles("subheading")).className}">Runners</h3>`,
    );
    expect(heading).toContain(">3<");
  });

  it("오른쪽 링크는 이름과 주소를 가진 a 다", () => {
    const html = renderToString(
      <Section title="Done today" titleRole="heading" link={{ href: "/runs", label: "모두 보기" }}>
        c
      </Section>,
    );
    expect(html).toMatch(/<a href="\/runs"[^>]*>모두 보기<\/a>/);
  });
});

describe("새 컴포넌트(티켓 0073)", () => {
  const periods = [
    { value: "7d", label: "7일", count: 12 },
    { value: "30d", label: "30일", count: 40 },
    { value: "all", label: "전체" },
  ] as const;

  it("SegmentedTabs 는 이름 있는 tablist 이고 고른 탭만 탭 순서에 있어 화살표로 옮긴다", () => {
    const html = renderToString(
      <SegmentedTabs value="30d" onValueChange={noop} label="기간" items={periods} />,
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="기간"');
    const tabs = html.match(/<button[^>]*role="tab"[^>]*>.*?<\/button>/g) ?? [];
    expect(tabs).toHaveLength(3);
    expect(tabs.map((tab) => /tabindex="(-?\d)"/.exec(tab)?.[1])).toEqual(["-1", "0", "-1"]);
    expect(tabs.map((tab) => /aria-selected="(\w+)"/.exec(tab)?.[1])).toEqual([
      "false",
      "true",
      "false",
    ]);
    expect(tabs[0]).toMatch(/>7일<span[^>]*>12<\/span>/);
    expect(tabs[2]).not.toContain("<span");
  });

  it("GroupHeader 는 상태 값으로 점 색을 고르고, 제목에 이름과 개수가 함께 있다", () => {
    const html = renderToString(
      <GroupHeader status="question" title="Question" count={2} description="답을 기다려요" />,
    );
    expect(html).toContain('data-tone="answer"');
    expect(html).toMatch(/<span aria-hidden="true"[^>]*><\/span><h3/);
    expect(html).toMatch(/<h3[^>]*>Question<span[^>]*> <!-- -->2<\/span><\/h3>/);
    expect(html).toContain("답을 기다려요");
    expect(
      renderToString(<GroupHeader status="failed" title="Failed" headingLevel="h2" />),
    ).toMatch(/data-tone="problem"[^>]*>.*<h2/);
  });

  it("CapacityBar 는 이름 있는 meter 이고 '쓰는/전체' 를 값 글로 읽는다", () => {
    const html = renderToString(<CapacityBar used={1} total={2} label="작업 칸" />);
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-label="작업 칸"');
    expect(html).toContain('aria-valuenow="1"');
    expect(html).toContain('aria-valuemax="2"');
    expect(html).toContain('aria-valuetext="1/2"');
    expect(html).toContain('data-tone="progress"');
    expect(html).toMatch(/aria-hidden="true"[^>]*>1\/2</);
    expect(
      renderToString(<CapacityBar used={2} total={2} label="작업 칸" tone="problem" />),
    ).toContain('data-tone="problem"');
    expect(renderToString(<CapacityBar used={0} total={0} label="작업 칸" />)).toContain(
      'aria-valuetext="0/0"',
    );
  });

  it("ProblemCallout 은 제목으로 이름 붙은 구역이고, 단계는 번호 목록, 행동은 마지막이다", () => {
    const html = renderToString(
      <ProblemCallout
        title="GitHub 인증이 깨졌어요"
        steps={["러너에서 gh auth login 을 실행해요", "다시 확인을 눌러요"]}
        actions={<Button>다시 확인</Button>}
      >
        이 러너는 PR 을 만들 수 없어요.
      </ProblemCallout>,
    );
    const labelledBy = /^<section aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(labelledBy).toBeDefined();
    expect(html).toMatch(new RegExp(`<h3 id="${labelledBy}"[^>]*>GitHub 인증이 깨졌어요</h3>`));
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html.indexOf("<ol")).toBeLessThan(html.indexOf("다시 확인</button>"));
    const plain = renderToString(<ProblemCallout title="Offline" />);
    expect(plain).not.toContain("<ol");
    expect(plain).not.toContain("<button");
  });

  it("StatTile 은 뜻으로 이름 붙은 묶음이고, 비교 줄은 좋아짐·나빠짐에 따라 색이 다르다", () => {
    const tile = (trend?: "better" | "worse") =>
      renderToString(
        <StatTile
          value="12"
          label="끝난 런"
          detail="지난주보다 3 늘었어요"
          {...(trend === undefined ? {} : { trend })}
        />,
      );
    const html = tile("better");
    const labelledBy = /role="group" aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(labelledBy).toBeDefined();
    expect(html).toMatch(new RegExp(`id="${labelledBy}"[^>]*>끝난 런<`));
    const detailClass = (h: string) => /data-trend="\w+" class="([^"]*)"/.exec(h)?.[1];
    expect(new Set([tile(), tile("better"), tile("worse")].map(detailClass)).size).toBe(3);
    expect(renderToString(<StatTile value="0" label="끝난 런" />)).not.toContain("data-trend");
  });

  it("StatusDot 은 상태 값으로 점 색을 고르고, 상태 이름은 화면 읽기용 글로 남긴다", () => {
    const html = renderToString(<StatusDot status="running">Running</StatusDot>);
    expect(html).toContain('data-tone="progress"');
    expect(html).toMatch(
      /<span aria-hidden="true"[^>]*><\/span><span class="[^"]+">Running<\/span>/,
    );
    const tones = PILL_STATUSES.map(
      (status) =>
        /data-tone="(\w+)"/.exec(renderToString(<StatusDot status={status}>x</StatusDot>))?.[1],
    );
    expect(tones).toEqual(PILL_STATUSES.map((status) => statusTone(status)));
    const dotClass = (status: PillStatus) =>
      /aria-hidden="true" class="([^"]*)"/.exec(
        renderToString(<StatusDot status={status}>x</StatusDot>),
      )?.[1];
    expect(dotClass("failed")).not.toEqual(dotClass("running"));
    expect(dotClass("failed")).toEqual(dotClass("offline"));
  });
});
