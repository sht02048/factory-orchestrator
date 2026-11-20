---
status: todo
blocked_by: [0144]
---

# 0145 요약 결과를 Succeeded·Failed·Canceled로 바꾸고 PR 정보를 곁에 보이기

## 목표

요약 결과를 에이전트 보고로만 정한다(R1). PR은 결과를 정하지 않고 정보(PR #n Open·Merged·Closed·못 읽음)로 곁에 붙는다. 스펙 [0005](../spec/0005-run-outcome.md), ADR [0022](../adr/0022-run-outcome-from-agent-report.md), 운영자 결정 R1·R5(2026-11-20).

## 배경

0144가 런 끝내기에서 PR 읽기를 떼고 PR 상태 `unknown`을 더했지만 결과 이름은 그대로 두었다. 그래서 PR을 못 읽은 보고 런이 Human Check로 보이고, PR 없이 끝난 성공 보고가 Failed로 보인다. 이 티켓이 이름과 계산을 바꾼다.

## 할 일

1. core summary: 요약 결과를 Succeeded·Failed·Canceled로 바꾼다. 완료 보고(성공)는 Succeeded, 완료 보고(실패)와 그 밖의 비정상 종료는 Failed, 운영자 취소는 Canceled다. 워크트리 처리 규칙은 PR 상태에서 계속 계산한다.
2. Home(Dashboard): To do에서 Human Check가 빠진다. 오늘 끝난 런은 결과로 센다.
3. Runs·Run 상세·Tickets: 필터, Assignable·끝남 정의, 상태 알약을 새 이름으로. PR 정보(PR #n 열림·병합됨·닫힘·못 읽음)를 결과 곁에 보인다.
4. Stats(R5): 결과(Succeeded/Failed/Canceled)로 세고, PR Merged 수는 PR 정보에서 따로 센다.
5. 알림 사건 종류에서 Human Check를 뺀다. 데스크톱 알림도 같이.
6. MCP: 요약 결과 값과 설명을 새 이름으로.
7. GLOSSARY: 요약 결과, To do, Assignable, 끝남, _Avoid_(Merged·Human Check를 결과 이름으로 쓰지 않기).
8. ADR 0010의 상태 이름·색 갱신: 요약 결과 Merged·Human Check → Succeeded, To do 종류에서 Human Check 빠짐.
9. 데모 픽스처(`demo/`, 시험 시드)를 새 이름에 맞춘다.

지난 런은 계산이라 자동으로 새 이름이 된다. DB 변경은 없다.

## 범위 밖

- 에이전트가 사람 확인을 요청하는 Waiting for Input 종류(R1의 "Human Check는 나중에 돌아온다"). 따로 정한다.

## 완료 조건

- 시험: core 요약 결과(에이전트 결과 × PR 상태 모두), Home To do와 오늘 끝난 런, Runs·Tickets 필터, Stats 세기, 알림 사건 종류.
- 스크린숏: Dashboard, Runs 목록, Run 상세, Stats.
- 화면 변경 있음. DB 변경 없음.
