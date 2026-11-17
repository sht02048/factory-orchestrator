import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  Button,
  DefinitionItem,
  DefinitionList,
  Dialog,
  DialogClose,
  Field,
  Input,
  Menu,
  MenuItem,
  Select,
  Status,
  Tab,
  Table,
  TableCell,
  TableRow,
  TableRows,
  Tabs,
  Text,
  Tooltip,
} from "./index";

const noop = () => {};

describe("서버 렌더", () => {
  it("Button 은 변형마다 다른 클래스를 갖고 disabled 를 넘긴다", () => {
    const primary = renderToString(<Button variant="primary">시작</Button>);
    const plain = renderToString(<Button>시작</Button>);
    const disabled = renderToString(<Button disabled>시작</Button>);
    expect(primary).toContain('type="button"');
    expect(primary).not.toEqual(plain);
    expect(disabled).toContain("disabled");
  });

  it("Status 는 점과 글을 함께 그리고, 점은 스크린 리더에서 숨긴다", () => {
    const html = renderToString(<Status tone="check">Human Check</Status>);
    expect(html).toContain("Human Check");
    expect(html).toContain('aria-hidden="true"');
    expect(
      renderToString(
        <Status tone="failed" dot={false}>
          Failed
        </Status>,
      ),
    ).not.toContain("aria-hidden");
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
});
