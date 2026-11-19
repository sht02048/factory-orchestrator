---
status: doing
blocked_by: []
---

# 0100 Dashboard 칸반: Queued · Running · Done today + Runners 열

## 목표

Dashboard 본문을 런 상태 기준 칸반 세 칸(Queued, Running, Done today)과 오른쪽 Runners 열로 바꾼다. 손댈 일(To do)은 따로 칸을 두지 않고 카드 꼬리표로 보이고, 카드를 누르면 오른쪽에 상세 패널이 덮여 열린다.

## 배경

운영자가 시안 KA·KB를 골랐다(2026-11-19). 지금 Dashboard는 본문이 1200px로 고정돼 왼쪽에 붙고, 넓은 창에서 오른쪽이 빈다. To do 묶음·In progress·Runners·Done today 네 구역이 두 열에 흩어져 런이 어디쯤 있는지 한눈에 보이지 않는다.

## 범위

1. **칸.** 칸은 런 상태 기준이다.
   - Queued: Queued 런.
   - Running: Running·Waiting for Input·Disconnected 런. Waiting for Input은 꼬리표 Question 또는 Permission(무엇을 기다리는지 아직 모르면 Waiting for Input), Disconnected는 꼬리표 Disconnected.
   - Done today: 꼬리표 Human Check·Failed 카드(To do에 오른 끝난 런)와 오늘 끝난 나머지 런. 나머지 런(Merged·Canceled, 이후 PR 상태가 기록된 Human Check, 새 런에 밀린 Failed)은 소제목 "처리할 일 없이 끝났어요" 아래에 모은다. To do에 오른 끝난 런은 어제 끝났어도 이 칸에 꼬리표로 남는다(처리할 일이 화면에서 사라지지 않게).
2. **꼬리표.** 손댈 일(Question·Permission·Human Check·Failed·Disconnected)은 카드 위 꼬리표(`StatusPill`, 점 + 이름)로 보인다. 꼬리표 카드가 칸 맨 위에 온다. Question 카드에는 질문 한 줄과 "답하기", Human Check 카드에는 "PR 보기"가 있다.
3. **머리.** 제목 "처리할 일이 {n}개 있어요" + 요약 문장은 그대로 두고, 오른쪽에 "모두 / 처리할 일만 {n}" 분할 버튼을 둔다. 처리할 일만이면 꼬리표 카드만 남긴다. 주소(`?view=todo`)에 남겨 새로 고침에도 그대로다.
4. **Runners 열.** 지금 Runners 구역(목록, 문제 카드, Runners에서 고치기)을 그대로 오른쪽 열(`dashboardSideWidth`)에 둔다.
5. **상세 패널.** 카드를 누르면 오른쪽에 덮여 열리는 패널(`Sheet`)이 열린다. Question이면 라디오 선택지·직접 쓰기·⌘ Enter 보내기를 패널 안에서, Permission이면 러너에서 허용하라는 안내와 거절, Human Check면 PR 링크, Failed면 이유(에이전트 결과·PR 상태 두 축)와 Tickets에서 다시 맡기기(Tickets의 새 런 시작을 그대로 쓴다), 그 밖엔 런 요약을 보인다. 모든 패널 끝에 "Run 상세 보기"가 있다. 닫기 버튼·Esc·바깥 누르기로 닫고 포커스는 누른 카드로 돌아간다. 카드의 "답하기"는 패널을 Question 상태로 연다. 지금의 답하기·거절하기 레이어는 이 패널로 바꾼다.
6. **긴 칸.** Queued·Running은 앞 6장, Done today 꼬리표 카드는 앞 4장만 보이고 "N개 더 보기"로 펼친다(펼치면 처음 숨었던 카드로 포커스). 처리할 일 없이 끝난 카드는 3장만 보이고 넘치면 "Runs에서 모두 보기" 링크를 둔다.
7. **반응형.** 본문 폭이 넓으면(창 약 1440px 이상) 3칸 + Runners 열, 그보다 좁으면 Runners를 칸반 아래로 내린다. 더 좁으면(창 약 900px 이하) 칸을 세로로 쌓는다. 가로 스크롤이 없고 320px에서도 잘리지 않는다. 본문 최대 폭 고정(1200px)을 없애 넓은 창에서 오른쪽이 비지 않는다.
8. **빈 칸.** 칸마다 한 줄("Queued 런이 없어요"). 카드 끌기는 없고 끌 수 있어 보이는 모양(손잡이, grab 커서)도 쓰지 않는다.
9. **데이터.** `HomePage`에 오늘 끝난 런 전체(`endedToday`, `HomeRun`)와 런마다 티켓 ID(`ticketId`, Tickets 선택 값)를 더한다. MCP가 쓰는 `doneToday`·`todoGroups`는 그대로 둔다.
10. **디자인 시스템.** `packages/ui`에 칸(`KanbanColumn`), 카드(`KanbanCard`), 오른쪽 패널(`Sheet`)을 더하고 DESIGN.md·`/ds`·시험을 함께 고친다. 기존 컴포넌트는 바꾸지 않는다.
11. **문서.** ADR 0010의 Dashboard 구조(왼쪽 To do 묶음 → 칸반 세 칸 + 꼬리표)와 GLOSSARY의 To do·Question·Runner Issue의 Dashboard 문장을 새 구조에 맞춘다. To do 낱말 자체(종류 다섯, 처리할 일)는 그대로다.

## 범위 밖

- 카드 끌어 옮기기.
- Runs·Runners·Tickets 화면(0095, 0101이 맡는다).

## 완료 조건

- [ ] 서버 렌더 시험: 칸 셋과 Runners 열, 칸마다 카드와 꼬리표(Question·Permission·Disconnected는 Running, Human Check·Failed는 Done today 위), 꼬리표 카드가 칸 맨 위, 처리할 일 없이 끝난 카드가 소제목 아래, 빈 칸 한 줄, 처리할 일만 보기에서 꼬리표 카드만 남음, 긴 칸의 "N개 더 보기".
- [ ] 로더 시험: `endedToday`가 오늘 끝난 런을 최근 순으로 담고 시간대를 따르며, `ticketId`가 Tickets의 티켓 ID와 같다.
- [ ] 브라우저 시험: 카드를 누르면 패널이 열리고 닫기·Esc·바깥 누르기로 닫으면 포커스가 카드로 돌아온다. "답하기"는 패널을 Question 상태로 열고 첫 선택지에 포커스가 간다. 고르기만 하면 보내지 않고 보내기·⌘ Enter로 보낸 뒤 결과를 status로 알린다. 거절도 패널에서 한다. 처리할 일만 보기가 새로 고침 뒤에도 남는다. 1728·1280·900·400·320px에서 가로 스크롤이 없고, 넓은 창에서는 Runners 열이 칸반 오른쪽, 좁은 창에서는 아래에 있다.
- [ ] `/ds`에 새 컴포넌트 미리보기, `components.test.tsx`에 서버 렌더 시험.
- [ ] ADR 0010·GLOSSARY·DESIGN.md 갱신.
- [ ] PR 본문 스크린숏: 1728px 기본·처리할 일만·Question 패널 열림, 1280px, 900px, 400px.
