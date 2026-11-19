---
status: done
blocked_by: []
---

# 0101 Runs·Runners 넓은 화면: 목록을 열로 나눠 패널까지 채우기

## 목표

넓은 창에서 Runs·Runners 목록이 상세 패널 바로 앞까지 채우고, 늘어난 폭을 열로 나눠 한 행에 더 많은 정보를 한 줄로 보인다. 좁아지면 열을 접어 지금의 두 줄 모양으로 돌아간다.

## 배경

운영자 결정(2026-11-19, 시안 W4). Runs 목록은 `size.runsListWidth`(960px), Runners 목록은 `size.runnerListMaxWidth`(900px)에서 멈추고 상세 패널은 창 오른쪽 끝에 붙어, 넓은 창에서 목록과 패널 사이가 크게 빈다.

## 범위

- **Runs(`apps/web/src/runs/runs-screen.tsx`).** 목록 폭 제한을 없앤다. 행을 열로 나눈다: 키 · 제목(남는 폭, 말줄임, 마우스를 올리면 전체 제목) · 러너 · 결과(끝난 런은 에이전트 결과와 PR 상태, 진행 중인 런은 에이전트) · 상태 알약 · 시간. 열 머리 줄을 둔다. 한 행은 한 줄이다.
- **열 접기.** 표 폭이 줄면 결과 → 러너 순으로 열을 빼고, 뺀 값은 제목 아래 둘째 줄로 돌아간다. 표 폭이 560px 밑이면 키도 제목 줄 안으로 들어가 제목·상태·시간 세 열이 되고(1100px 창), 440px 밑이면 한 열로 쌓는다. 컨테이너 쿼리로 정하고 가로 스크롤은 없다.
- **제목 열 최대 폭.** 제목 열은 최대 `size.runTitleMaxColumn`(640px)까지만 넓어지고 남는 폭은 결과 열이 받는다.
- **Runners(`apps/web/src/runners/runners-screen.tsx`).** 목록 폭 제한을 없앤다. 자리·사용량 열 사이 남는 폭은 이름·설명 열이 받는다. 목록 배치만 고친다.
- **`packages/ui`.** `Table`에 열 접기(선택 속성 `foldedColumns`의 `first`·`second`·`third`), `TableCell`·`TableHeader`에 접히면 숨기기(`hideWhen`), 접혔을 때만 보이는 `TableFoldedOnly`, `RowTitle`에 전체 제목(`fullText`)을 더한다. 쓰지 않게 된 `size.runsListWidth`, `size.runnerListMaxWidth`를 지운다. DESIGN.md와 /ds를 함께 고친다.

## 완료 조건

- 시험(`packages/ui`): 열 접기 격자, 접히면 숨는 칸과 접혔을 때만 보이는 내용의 컨테이너 쿼리, `RowTitle` 전체 제목.
- 화면 시험(Runs): 열 머리, 한 행에 키·제목·러너·결과·상태·시간, 결과 문장(끝난 런, 진행 중인 런, 취소 중), 접혔을 때 둘째 줄.
- 브라우저 시험: Runs·Runners가 1728px·1280px·900px·400px에서 가로로 넘치지 않고, 넓은 창에서 목록이 패널 바로 앞까지 채운다.
- 스크린숏: Runs·Runners 1728px·1280px·900px·400px 전·뒤.
- 마무리 리뷰: `better-interface` 리뷰 → HIGH·MEDIUM 고침 → `interface-review`로 새 서브에이전트 리뷰 → 표를 PR 본문에.
