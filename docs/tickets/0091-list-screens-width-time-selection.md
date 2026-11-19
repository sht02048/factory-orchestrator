---
status: doing
blocked_by: []
---

# 0091 목록 화면 손보기: Dashboard·Runs·Tickets (폭, 시간 칸, 고른 행)

## 목표

넓은 화면에서 Dashboard와 Runs의 글·시간·버튼이 서로 멀어지지 않게 본문 폭을 묶는다. 시간 글의 길이가 달라도 시간과 버튼이 같은 자리에 서게 한다. 고른 행은 중립 회색 바탕 하나로 보인다.

## 배경

운영자 결정(2026-11-19, 시안 U6·U7)이다.

- 1728px 화면에서 Dashboard To do 카드가 끝까지 늘어나 글과 시간·버튼이 멀다.
- "42초째", "12분째", "1시간 3분째", "4분 전", "11월 17일"처럼 시간 글 길이가 달라 그 오른쪽 버튼과 열이 흔들린다.
- Runs 필터 열 개가 한 줄에 늘어서고, 상태 알약이 시간 칸 옆 오른쪽 끝에 붙어 제목에서 멀다.
- 고른 행의 왼쪽 노란 막대와 노란 기 도는 바탕이 강조색(Ganger Yellow)을 "고름"에 빌려 쓴다.

## 범위

- **Dashboard 폭.** 머리와 두 열을 최대 `size.dashboardWidth`(1200px)로 묶고 남는 공간은 오른쪽 여백으로 둔다. 오른쪽 열(Runners·Done today)은 `size.dashboardSideWidth` 360px다.
- **시간 칸(`packages/ui` `TimeSlot`, `RowActionSlot`).** 시간 글을 고정 폭(`size.timeColumn` 88px)·오른쪽 정렬·tabular-nums 칸에 둔다. 그 오른쪽 버튼 칸(`RowActionSlot`, `size.rowActionColumn`)도 고정 폭이고 버튼은 칸 오른쪽에 붙는다. Dashboard To do·In progress·Done today 행이 쓴다. 버튼이 없는 To do 행도 빈 버튼 칸을 두어 같은 묶음 안 시간이 한 줄로 선다. Runs 목록의 시간 열은 같은 폭(`size.timeColumn`)의 `TableCell align="end" numeric`이다.
- **Runs 폭과 필터.** 목록을 최대 `size.runsListWidth`(960px)로 묶는다. 상태 알약은 제목 바로 옆 고정 칸(`size.runStatusColumn` 152px)에 왼쪽 정렬로 두고 그 뒤에 시간 칸을 둔다. 필터는 두 줄이다.
  - 위 줄(`SegmentedTabs`): 모두 / 처리할 일 / 진행 중 / 끝남. Tickets 필터와 같은 낱말이고 런 기준 뜻은 GLOSSARY Tickets 필터 아래에 적었다. 처리할 일은 지금의 `attention`(주소 `f=attention`), 진행 중은 Queued·Running(`f=in-progress`), 끝남은 처리할 일이 아닌 끝난 런(`f=done`)이다. 세 묶음과 모두 말고는 겹치지 않는다.
  - 아래 줄(`Tabs variant="compactChips"`): 상태별 작은 칩과 개수. Running·Waiting for Input·Disconnected·Queued·Merged·Human Check·Failed·Canceled. 시안에는 Running이 없지만 지금 주소 `f=running`을 남기려고 넣었다.
  - 두 줄은 각각 이름 붙은 tablist이고 값 하나(주소 `f`)를 함께 바꾼다. 지금 고른 값이 없는 줄은 고른 탭이 없다.
- **고른 행.** `bgSelected`를 무채색으로 바꾸고 `TableRow`의 노란 막대를 뺀다. Tickets·Runs·Runners 목록이 함께 바뀐다. 키보드 포커스 링은 그대로다.
- **Tickets.** 목록 행에 시간 글이 없어 시간 칸을 더하지 않았다. 고른 행 모양만 바뀐다.

## 범위 밖

- Runners·Stats 화면 파일, 웹 로더(`load.ts`).

## 완료 조건

- `packages/ui`: `TimeSlot`·`RowActionSlot`·`Tabs variant="compactChips"` 서버 렌더 시험(`components.test.tsx`), 고른 행 막대가 없고 `bgSelected`가 무채색인 시험(`tokens.test.ts`), `/ds` 미리보기, DESIGN.md.
- Runs: 묶음 필터 판정 시험(`model.test.ts`), 두 줄 필터와 개수·고른 탭 시험(`runs-screen.test.tsx`), 주소 `f` 값 검증.
- Dashboard: 시간이 `TimeSlot`에, 버튼이 `RowActionSlot`에 들고 버튼 없는 To do 행도 빈 칸을 두는 시험(`home-screen.test.tsx`).
- Dashboard·Runs·Tickets 1728px·1280px 전·뒤 스크린숏.
