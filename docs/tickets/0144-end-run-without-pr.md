---
status: doing
blocked_by: []
---

# 0144 런 끝내기에서 PR 읽기를 떼고, 못 읽음을 보이기

## 목표

PR을 읽지 못해도 런이 끝나고 러너 자리를 비운다. 못 읽은 사실과 이유를 런과 Settings에 보이고, 읽을 수 있게 되면 PR 상태를 채운다. 스펙 [0005](../spec/0005-run-outcome.md), ADR [0022](../adr/0022-run-outcome-from-agent-report.md), 운영자 결정 R1~R6(2026-11-20).

## 배경

2026-11-20 org 비공개 저장소의 런에서 GitHub 토큰이 그 저장소를 볼 수 없어 worker의 PR 읽기(`decideRunPrState`)가 던졌다. worker는 `run.watch_failed`만 남기고 다음 tick에 같은 일을 되풀이했고, 런은 Running으로 남아 러너 자리를 차지했다. DB는 `runs_pr_state_iff_ended`로 PR 상태 없이 끝낼 수 없게 막았다(스펙 1절).

## 할 일

1. [x] 런 끝내기에서 PR 읽기 실패가 끝내기를 막지 않게 한다. watch의 세 경로와 after-run 경로 모두. 못 읽으면 PR 상태 `unknown`과 이유로 끝낸다.
2. [x] 결과 계산(`packages/core/src/summary.ts`)이 `unknown`을 받는다. 결과 이름 바꾸기는 0145다. 아래 「요약 결과」.
3. [x] 다시 읽기 간격(1분에서 두 배씩, 최대 30분), 토큰이 바뀌면 바로 다시 읽기, 읽으면 PR 상태를 채우고 그때 워크트리 처리 규칙을 적용한다. 못 읽은 동안 워크트리를 지우지 않는다.
4. [x] Run 상세·Runs 목록의 짧은 표시, Settings GitHub 줄 문제 표시와 목차 점. 이유 구분은 GitHub 응답을 zod로 파싱한 오류 종류에서 정한다. 서버 로그 `run.pr_read_failed`(warn).
5. [x] MCP 런 읽기 결과의 PR 상태 필드가 `unknown`과 이유 값을 그대로 보인다.
6. [x] 기존 DB의 런은 그대로 둔다(새 값은 새로 끝나는 런에만).
7. [x] 스펙 0005, ADR 0022, 티켓 0145, GLOSSARY의 PR 상태 값.

## 요약 결과

결과 이름은 0145가 바꾸므로, 이 티켓에서 `unknown`의 요약 결과는 지금 이름 체계에서 가장 덜 틀린 값으로 둔다.

- 완료 보고(성공·실패) + `unknown` → Human Check. 에이전트는 보고했고 PR이 있는지 모른다. Failed는 PR이 없다고 단정하고 Merged는 근거가 없다. Human Check는 사람이 보게 To do에 올린다. PR을 읽으면 그 값으로 다시 계산되어 To do에서 빠지거나(Merged·Failed) 그대로 남는다(열림).
- 그 밖의 에이전트 결과 + `unknown` → 지금과 같은 Failed·Canceled. PR 상태와 상관없는 결과다.
- 워크트리 처리는 `keep-until-pr-read`(PR을 읽을 때까지 남김)다. 러너에 닿지 못한 취소·러너 연결 끊김(운영자가 정함)과 시작하지 못함·워크트리 없음(지울 것 없음)은 그대로다.

## DB 변경과 되돌리기

- `runs.pr_state` 값 목록에 `unknown`을 더하고, 새 열 `pr_read_error`(`no-access`·`other`)와 제약 `runs_pr_read_error`·`runs_pr_read_error_iff_unknown`을 더한다. SQLite는 CHECK를 고칠 수 없어 runs 표를 다시 만든다. 기존 행은 값 그대로 옮겨지고 새 열은 NULL이다.
- one-way다. 새 버전이 `unknown` 행을 쓰고 나면 옛 버전의 행 읽기가 그 값을 모른다.
- 되돌리는 법: 옛 버전을 띄우기 전에 서버를 멈추고 DB에서 `UPDATE runs SET pr_state = 'none', pr_read_error = NULL WHERE pr_state = 'unknown';`을 돌린다. 옛 버전은 새 열과 넓어진 CHECK를 쓰지 않으므로 그대로 둔다. 그 런들은 옛 버전에서 PR 없음으로 보이고, 보고한 런은 Failed가 되며 워크트리가 지워진다.

## 완료 조건

- [x] 시험: 권한 오류·없음·네트워크 오류·성공 각각에서 런이 한 tick 안에 끝나고 러너 자리가 빈다(watch).
- [x] 시험: 러너 진행을 읽지 못한 채 취소·러너가 등록에 없는 채 시간 초과에서도 PR을 못 읽고 끝난다.
- [x] 시험: 다시 읽기 간격(1분, 2분, …)과 최대값 30분, 토큰 바뀐 뒤 바로 다시 읽기.
- [x] 시험: 읽은 뒤 PR 상태가 채워지고 이유가 지워지며 워크트리 규칙이 그때 적용된다. 못 읽은 동안 워크트리를 지우지 않는다.
- [x] 시험: 이유 구분(`not-found`·`unauthorized` → `no-access`, 그 밖 → `other`).
- [x] 시험: core 요약 결과와 워크트리 처리.
- [x] 시험: 마이그레이션 앞뒤(기존 행 그대로, `unknown`과 이유 제약).
- [x] 시험: Settings GitHub 줄 문제 표시와 목차 점, Run 상세 표시, Runs 목록 행.
- [x] 스크린숏: Run 상세의 PR 못 읽음 표시, Runs 목록 행, Settings GitHub 줄 문제 표시.
- DB 변경 있음(one-way). 화면 변경 있음.
