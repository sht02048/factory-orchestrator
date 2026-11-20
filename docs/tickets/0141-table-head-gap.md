---
status: done
blocked_by: []
---

# 0141 표 머리글과 첫 행 사이 간격

## 목표

운영자 보고(2026-11-20, Runs 화면에서 첫 행을 고른 상태): "머리글(키·제목·상태·시간)과 첫 줄 사이 간격이 부족해. 선택됐을 때 테두리가 생기니까 너무 가까워 보여." 표 머리글과 첫 행 사이에 간격을 둔다.

## 지금

- `packages/ui`의 `Table` 머리(`TableHead`)는 높이 30이고 바로 아래에 행 목록(`TableRows`)이 붙는다. 고른 행은 `rowSelected`의 `inset 0 0 0 1px borderSelected` 테두리와 배경이 생겨, 머리글 글자 바로 밑에 테두리 선이 닿아 보인다. 포커스 링(`outline 2px`, offset -2)과 hover 배경도 같은 자리에서 시작한다.
- Runners 목록은 같은 `Table` 안에 `ResponsiveColumnsHead`를 머리로 쓰고, 높이(`size.tableHeadHeight` 30)와 붙는 방식이 같아 같은 문제가 있다.

## Table 을 쓰는 화면

- Runs(`TableHead`, 접힘·좁은 폭 머리 숨김), Tickets(`TableHead`), Runners(`ResponsiveColumnsHead`, 600 미만이면 머리 숨김), `/ds` 견본.
- Dashboard 는 `Table`을 쓰지 않는다. Stats 표는 `DataTable`(고를 수 없는 정적 표, 선택 테두리 없음)이라 바꾸지 않는다.

## 할 일

- [x] `Table` 머리와 `ResponsiveColumnsHead` 머리 아래에 `space.s2`(8px) `margin-bottom`을 둔다. 행 사이 간격(`space.px2`)·행 높이·머리 높이는 그대로다.
- [x] 머리를 숨기는 폭(`display: none`)에서는 여백도 함께 사라져 빈 틈이 생기지 않는다.
- [x] 선택·hover·포커스 링 상태의 첫 행을 넓은 폭에서 눈으로 확인한다.
- [x] DESIGN.md 의 `Table`·`tableHeadHeight` 설명을 고친다.

## 값을 정한 이유

- 고치기 전에는 머리글 글자 아래(작은 글자, 30 높이 칸 가운데)에서 첫 행 테두리까지 약 12px 이었다(1440 스크린숏에서 잼). 글자와 테두리 선의 대비가 커서 선이 글자 밑줄처럼 붙어 보였다.
- `space.s1`(4px)을 더하면 여전히 머리글이 행에 딸린 것처럼 보였고, `space.s2`(8px)를 더하면 글자에서 테두리까지 약 20px 로 행 안쪽 위 여백(`space.s3` 12px)보다 넓어져 머리글이 행 묶음 위의 따로 된 줄로 읽힌다. `space.s3` 이상은 목록 첫 행이 머리와 떨어져 보여 열 이름과 값의 짝이 약해진다. 그래서 8px 로 정했다.
- 포커스 링은 행 안쪽(offset -2)에 그려져 이 틈 안에서 머리 쪽으로 넘어오지 않는다.

## 완료 조건

- e2e `src/runs.test.ts` '머리글과 첫 행 사이에 8px 을 두고, 머리글을 숨긴 좁은 폭에서는 빈 틈을 남기지 않는다(0141)': 1440 에서 첫 행 위 끝 − 머리 아래 끝 = 8, 400(머리 숨김)에서 첫 행 위 끝 = 표 위 끝. 고치기 전 코드에서 `belowHead` 0 으로 실패한다.
- 스크린숏: Runs 첫 행 선택 전·후(1440), Tickets 첫 행 선택(1440), 좁은 폭 Runs(480, 머리글 숨김).
- DB 변경 없음. two-way.
