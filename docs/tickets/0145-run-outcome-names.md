---
status: doing
blocked_by: [0144]
---

# 0145 요약 결과를 Succeeded·Failed·Canceled로 바꾸고 PR 정보를 곁에 보이기 + 일을 잃지 않는 워크트리 정리

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

지난 런은 계산이라 자동으로 새 이름이 된다.

### 운영자가 더한 범위(2026-11-21, R7)

배경: 0.2.0 운영에서 런 DEE-12의 에이전트가 커밋만 하고 push·PR 없이 성공 보고를 했다. 결과 계산이 "성공 + PR 없음 → Failed, 워크트리 바로 지움"이라 worker가 워크트리를 지웠다. 로컬 브랜치가 남아 커밋은 살았지만, 커밋하지 않은 변경이었다면 잃었다. 운영자 결정 원문은 스펙 [0005](../spec/0005-run-outcome.md) 3절, 설계는 10절에 둔다.

10. R7-1 워크트리를 지우기 전에 러너에서 그 워크트리에 커밋하지 않은 변경(추적·비추적 파일)이나 원격에 없는 커밋이 있는지 확인한다. 하나라도 있거나 확인하지 못하면(러너 못 닿음·명령 실패) 지우지 않고 남긴다. 결과와 상관없이 적용한다(Canceled·Failed도). 러너 쪽 확인은 Orca 러너 어댑터의 명령 경로를 넓혀서 하고, 출력은 zod로 파싱하며, 러너 호출 로그 규칙을 따른다.
11. R7-2 Succeeded인데 PR이 없으면(none) 워크트리를 남긴다. 남은 이유를 Run 상세에 보인다("push하지 않은 커밋이 있어 워크트리를 남겼어요", "PR이 없어 워크트리를 남겼어요" 등).
12. R7-3 남긴 워크트리를 지우는 길이 러너에서 직접 지우는 것뿐이라, Run 상세에 "워크트리 지우기"(확인 대화상자, 위험 표시)를 더한다. MCP 쓰기 도구는 더하지 않는다.

DB 변경이 있다. `runs`에 남긴 이유(`worktree_kept`)와 운영자 지우기 요청(`worktree_remove_requested_at`) 열을 더하고, 알림 사건 종류에서 `human-check`를 빼며 그 종류의 기존 사건을 지운다. runs·notification_events 표를 다시 만드는 one-way 마이그레이션이다. 되돌리려면 이 버전 전의 DB 백업으로 돌아가야 한다(옛 버전은 새 마이그레이션이 적힌 DB를 다운그레이드로 거부한다).

## 범위 밖

- 에이전트가 사람 확인을 요청하는 Waiting for Input 종류(R1의 "Human Check는 나중에 돌아온다"). 따로 정한다.

## 완료 조건

- 시험: core 요약 결과(에이전트 결과 × PR 상태 모두), Home To do와 오늘 끝난 런, Runs·Tickets 필터, Stats 세기, 알림 사건 종류.
- 시험(R7): 커밋하지 않은 변경 있음·없음, push하지 않은 커밋, 확인 실패 각각에서 남김·지움, Succeeded + PR 없음 남김, 운영자 지우기.
- 스크린숏: Dashboard, Runs 목록, Run 상세, Stats, Run 상세의 "워크트리를 남겼어요" 상태.
- 화면 변경 있음. DB 변경 있음(one-way).
