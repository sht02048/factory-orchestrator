# 런 결과 스펙

런이 어떻게 끝났는지를 무엇으로 정하고, PR을 읽지 못할 때 런과 러너 자리와 워크트리를 어떻게 다루는지 정하는 기준 문서다. 2026-11-20 운영 사고와 같은 날 운영자 결정 R1~R6을 한곳에 묶는다. R1~R6은 3절에 운영자가 정한 문장 그대로 두었다. 본문은 그 결정을 코드 위치에 맞춰 풀어 쓴 것이고 새 결정을 만들지 않는다.

함께 쓴 ADR은 [0022](../adr/0022-run-outcome-from-agent-report.md)다. 이 문서를 쪼갠 티켓은 [0144](../tickets/0144-end-run-without-pr.md)(런 끝내기에서 PR 읽기를 떼고, 못 읽음을 보이기)와 [0145](../tickets/0145-run-outcome-names.md)(요약 결과 이름을 Succeeded·Failed·Canceled로 바꾸기)다. 용어는 [GLOSSARY](../../GLOSSARY.md)를 따른다.

## 1. 배경(2026-11-20 운영 사고)

org 비공개 저장소의 런에서 에이전트가 끝났다고 보고했는데, Ganger 서버의 GitHub 토큰이 그 저장소를 볼 수 없어 GraphQL 이 repository not found 를 돌려줬다. worker 는 런을 끝내기 전에 PR 상태를 읽는데(`apps/worker/src/watch.ts` 의 `decideRunPrState`), 이 읽기가 던지면 `run.watch_failed` 경고만 남기고 다음 tick 에 같은 일을 끝없이 되풀이했다. 런은 Running 으로 남아 러너 자리를 차지했고 화면에는 원인이 보이지 않았다. DB 는 `runs_pr_state_iff_ended`(ended ⇔ pr_state NOT NULL)로 PR 상태 없이 끝낼 수 없게 막고 있다.

## 2. 목표와 완료 기준

목표: 런이 끝나는 일은 에이전트와 러너에만 달려 있다. 코드 호스트를 읽지 못해도 런은 끝나고 러너 자리를 비운다. 읽지 못한 사실과 이유는 런과 Settings에 보이고, 읽을 수 있게 되면 PR 상태가 채워지고 워크트리 처리가 그때 이어진다.

완료 기준(0144):

- PR 읽기가 권한 오류·없음·네트워크 오류 무엇으로 실패해도 런은 그 tick 안에 Ended가 되고 러너 자리가 빈다(watch의 세 끝내기 경로 모두).
- 못 읽은 런의 PR 상태는 `unknown`(화면 "못 읽음")이고 이유(`no-access` 토큰이 이 저장소를 볼 수 없음 / `other` 그 밖)를 함께 저장한다.
- worker가 1분에서 시작해 두 배씩, 최대 30분 간격으로 다시 읽는다. GitHub 토큰이 바뀌면 다음 tick에 바로 다시 읽는다. 읽으면 PR 상태를 채우고 이유를 지우며, 그때 워크트리 처리 규칙을 적용한다. 못 읽은 동안 워크트리를 지우지 않는다.
- Run 상세와 Runs 목록에 "PR 정보를 읽지 못했어요"와 이유가 보이고, Settings의 GitHub 줄에 문제 표시와 목차 점이 붙는다.
- 서버 로그에 `run.pr_read_failed`(warn)가 남는다.
- MCP 런 읽기 결과의 PR 상태 필드가 `unknown`과 이유 값을 그대로 보인다.
- 기존 DB의 런은 바뀌지 않는다.

완료 기준(0145): 요약 결과가 Succeeded·Failed·Canceled이고 PR 정보는 곁에 붙는다. 0145 티켓에 적는다.

## 3. 운영자 결정(2026-11-20)

- R1 런 결과는 에이전트 보고로만 정한다: Succeeded / Failed / Canceled. PR 은 결과를 정하지 않고 정보(PR #n Open·Merged·Closed)로 붙는다. Human Check 는 나중에 에이전트가 요청하는 Waiting for Input 종류로 돌아온다(이번 범위 밖).
- R2 PR 을 읽지 못하면(권한·없음·네트워크 등 무엇이든) 런은 바로 끝나고 러너 자리를 비운다. PR 상태는 "아직 못 읽음"으로 두고 나중에 채운다. 이를 위한 값(예: `unknown`)과 DB 제약 변경은 이 티켓에서 정한다(마이그레이션이면 one-way, 되돌리는 법을 티켓에 적는다).
- R3 못 읽음은 보인다: 런(Run 상세·목록)에 "PR 정보를 읽지 못했어요"와 이유(토큰이 이 저장소를 볼 수 없음 / 그 밖), Settings 의 GitHub 줄에 문제 표시(목차 점 규칙 따름). 문구는 메시지 파일(ko, en), 해요체.
- R4 PR 을 못 읽은 런의 워크트리는 PR 을 읽을 때까지 남긴다(지우지 않는다). 다시 읽기는 간격을 늘려 가며 한다(예: 1분에서 시작해 최대 30분). 권한 오류도 다시 읽기에 포함한다(토큰을 고치면 다음 읽기에 채워지게). 토큰이 바뀌면 다음 tick 에 바로 다시 읽는다.
- R5 Stats·Home "오늘 끝난 런" 은 결과(Succeeded/Failed/Canceled)로 세고, PR Merged 수는 PR 정보에서 따로 센다 — 0145.
- R6 티켓은 둘: 0144(이것) → 0145.

## 4. PR 상태 `unknown`과 이유(R2)

- `packages/core` `PR_STATES`에 `unknown`을 더한다. 뜻은 "런이 끝날 때 PR을 읽지 못했고 아직 못 읽음"이다. 읽으면 none·open·merged·closed 중 하나로 바뀐다. GLOSSARY의 PR 상태 "끝날 때 한 번 기록하고 바꾸지 않는다"는 이 값만 예외다.
- 이유는 `PR_READ_ERRORS = no-access | other`로 `runs.pr_read_error` 열에 둔다. 코드 호스트 어댑터가 GitHub 응답을 zod로 파싱해 낸 오류 종류(`not-found`는 GraphQL `NOT_FOUND`·HTTP 404, `unauthorized`는 `FORBIDDEN`·401·403)를 worker가 다시 zod로 읽어 `no-access`로, 나머지(네트워크, 요청 한도, 응답 모양, 어댑터 만들기 실패)를 `other`로 둔다.
- DB 제약: `runs_pr_read_error`(값 목록), `runs_pr_read_error_iff_unknown`(`pr_state`가 `unknown`일 때만, 그리고 그때는 반드시 이유가 있다). `runs_pr_state_iff_ended`는 그대로 둔다. 끝난 런은 늘 PR 상태가 있고, 못 읽으면 그 값이 `unknown`이다.
- 마이그레이션은 runs 표를 다시 만든다(SQLite는 CHECK를 고칠 수 없다). 기존 행은 값이 그대로 옮겨지고 새 열은 NULL이다(R2, 0144 5번).

## 5. 끝내기와 다시 읽기(R2·R4)

- 끝내기: watch의 세 경로(에이전트가 보고하거나 사라짐·취소·시간 초과로 끝남, 러너 진행을 읽지 못한 채 취소·시간 초과, 러너가 등록에 없는 채 시간 초과)가 모두 같은 읽기 함수를 부른다. 읽기가 던지면 `run.pr_read_failed`를 남기고 `unknown`과 이유로 끝낸다. 런 도중 읽어 둔 PR 기록(PR #n, CI)은 지우지 않는다.
- 다시 읽기: after-run이 Ended이고 `unknown`인 런을 맡는다. 간격은 실패 횟수 n에 대해 min(1분 × 2^(n−1), 30분)이다. 끝낼 때의 실패가 첫 번째다. 간격은 worker 메모리에 두고, worker가 다시 시작하면 다음 tick에 바로 읽는다.
- 토큰 바뀜: 코드 호스트 연결 설정(토큰 포함)의 hash를 실패 때마다 함께 기억하고, 지금 hash와 다르면 간격과 상관없이 바로 읽는다.
- 읽으면: PR 상태와 PR 기록을 채우고 이유를 지운 뒤, 같은 tick에 그 런의 워크트리 처리 규칙(요약 결과에서 계산)을 적용한다.
- 워크트리: `unknown`인 동안 워크트리 처리는 `keep-until-pr-read`(PR을 읽을 때까지 남김)다. 운영자가 정해야 하는 경우(러너에 닿지 못한 취소, 러너 연결 끊김)와 지울 것이 없는 경우는 그대로 둔다.

## 6. 요약 결과(0144 임시, 0145에서 바꿈)

0144는 결과 이름을 바꾸지 않는다. 지금 이름 체계에서 `unknown`의 요약 결과는 다음으로 둔다.

| 에이전트 결과        | PR 상태 `unknown`의 요약 결과 | 이유                                                                                                                                                                                 |
| -------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 완료 보고(성공·실패) | Human Check                   | 에이전트가 보고했고 PR이 있는지 모른다. Failed는 PR이 없다고 단정하고, Merged는 근거가 없다. Human Check는 사람이 보게 To do에 올린다(이후 PR 상태가 기록되거나 PR을 읽으면 빠진다). |
| 그 밖                | 지금과 같음(Failed·Canceled)  | 이 결과들은 PR 상태와 상관없다.                                                                                                                                                      |

## 7. 보이기(R3)

- Run 상세: PR 상태 값 "못 읽음"과 함께 "PR 정보를 읽지 못했어요"와 이유 문장을 보인다.
- Runs 목록: 행의 짧은 정보에 "PR 못 읽음"을 보인다. 상세 패널에 이유 문장을 보인다.
- Settings: GitHub 줄의 둘째 글줄이 PR을 읽지 못한 런 수와 이유를 문제 색으로 보이고, 연결 구역 목차에 점을 붙인다.
- 문구는 `apps/web/messages/ko/`의 화면 메시지 파일과 `domain.json`에 둔다. 지금 저장소에는 ko 메시지 파일만 있다(en 메시지 파일이 생기면 같은 키를 더한다).
- MCP: `get_run`·`list_runs`의 PR 상태 필드가 `unknown`을 그대로, 이유를 `prReadError` 값(`no-access`·`other`)으로 보인다. 문구가 아니다.

## 8. 두 티켓의 경계

- 0144: 4~7절. 결과 이름·색·통계·알림 종류는 바꾸지 않는다. GLOSSARY는 PR 상태 값 `unknown`만 더한다.
- 0145: 요약 결과를 Succeeded/Failed/Canceled로 바꾸고 PR 정보를 곁에 보인다. core summary, Home(To do에서 Human Check 빠짐, 오늘 끝난 런), Runs·Run 상세·Tickets(필터·Assignable·끝남 정의), Stats(R5), 알림 사건 종류(Human Check 빠짐)·데스크톱 알림, MCP, GLOSSARY(요약 결과·To do·Assignable·끝남·_Avoid_), ADR 0010의 상태 이름·색 갱신, 데모 픽스처. 지난 런은 계산이라 자동으로 새 이름이 된다.

## 9. 위험

- 마이그레이션은 one-way다. 새 버전이 `unknown` 행을 쓰고 나면 옛 버전은 그 값을 읽지 못한다. 되돌리는 법은 티켓 0144에 적는다.
- 토큰이 끝내 저장소를 볼 수 없으면 그 런의 워크트리는 러너에 계속 남는다(R4가 정한 대로). Runners의 남은 워크트리와 Settings의 문제 표시로 보인다.
- 다시 읽기 간격은 worker 메모리에 있어 worker가 자주 다시 시작하면 1분보다 자주 읽을 수 있다. tick 하나에 런마다 한 번이라 GitHub 요청 한도에 닿을 만큼은 아니다.
- 0144와 0145 사이에는 PR 상태를 못 읽은 보고 런이 Human Check로 보인다. 0145가 결과 이름을 바꾸면 Succeeded·Failed가 된다.
