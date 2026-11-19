---
status: todo
blocked_by: [0124]
---

# 0125 Runs·Run 상세를 Query로

## 목표

Runs 목록과 Run 상세를 Query로 옮기고 변경 기록으로 갱신한다. 쓰기 뒤에 화면 전체를 다시 읽지 않고 그 런의 query만 다시 읽는다. 스펙 [0003](../spec/0003-query-cache.md) 4.3~4.5절, 운영자 결정 C4·C5·C6·C12.

## 배경

- Runs·Run 상세는 머무는 동안 다시 읽지 않는다. Run 상세의 쓰기·로그 폴링은 모두 필터 없는 `router.invalidate()`다(research [0016](../research/0016-web-data-loading.md) 3·4절).
- 시간대를 처음 정할 때 루트의 `TimeZoneSync` 필터에 `/_app/runs`가 빠져 Runs를 다시 읽지 않는다(research 0016 8절 4번).

## 할 일

1. **query.** `["runs", "list", { ws, ended, ...conditions }, timeZone]`(`getRunsPage`), `["runs", "detail", runId]`(`getRunDetail`). 로더와 컴포넌트가 같은 `queryOptions`를 쓴다. 두 route에 `preloadStaleTime` 0(0123이 확인한 이름)을 준다.
2. **시간대를 key에.** 시간대는 루트 로더가 읽은 쿠키 값이다. 쿠키가 바뀌면 key가 바뀌어 Runs가 새로 읽는다. `TimeZoneSync`의 필터에서 빠진 Runs 문제가 이것으로 없어지는 것을 시험한다.
3. **mutation(C5).** 답하기, 거절, 취소, 멈추기와 재개, 로그 다시 받기. 서버 함수는 바꾸지 않는다. `mutationFn`이 0124의 변환 함수로 `{ ok: false, reason }`과 `answerQuestion`·`denyPermission`이 throw한 오류를 이유가 담긴 오류 타입으로 바꾼다. `expectOk`를 지운다. 멈추기·재개(`controlRun`)의 `ok: false`는 지금처럼 오류가 아니라 "상태가 바뀜" 결과로 화면에 돌려준다(스펙 4.4). 성공하면 `["runs", "detail", runId]`와 `["runs", "list"]`만 무효화한다. 멈추기·재개가 "상태가 바뀜"을 돌려줘도 지금처럼 그 런의 key를 무효화한다. 로그 다시 받기(`requestRunLog`, boolean을 돌려준다)는 `["runs", "detail", runId]`만 무효화한다.
4. **열 때 로그 요청.** `requestRunLog` 뒤에 `["runs", "detail", runId]`만 무효화한다(지금은 화면 전체).
5. **처리 중 폴링.** 로그 받는 중(2초, 최대 15번)과 멈추기·재개 처리 중(2초)을 그 query의 `refetchInterval`로 옮긴다.
6. **구독 연결.** 0124의 구독 모듈이 `run`·`assignment` 바뀜에 이 key들을 무효화하는지 화면에서 확인한다.
7. 두 route에서 `router.invalidate()`를 지운다. 아직 옮기지 않은 화면도 바꾸는 쓰기는 옮기는 동안 그 route id만 고른 `router.invalidate({ filter })`를 함께 부른다(스펙 6절 3번).

## 완료 조건

- [ ] 시험: 서버 렌더한 화면에서 hydration이 끝날 때까지 이 화면의 서버 함수를 다시 부르지 않는다.
- [ ] 시험: mutation 하나 뒤 다시 읽는 서버 함수가 그 mutation이 바꾼 query뿐이다. 루트(`getTimeZone`, `getTitleBarHidden`)와 셸(`getShell`)은 다시 읽지 않는다(스펙 7절 2번의 예외 제외).
- [ ] 시험: worker와 같은 함수로 런 상태를 바꾸면 열린 Runs와 Run 상세가 3초 안에 바뀐다.
- [ ] 시험: SSE가 끊기면 열린 Run 상세가 30초마다 다시 읽는다(가짜 시계).
- [ ] 시험: 시간대 쿠키가 바뀌면 Runs가 새 시간대로 다시 읽는다.
- [ ] 시험: `ok: false` 결과가 이유가 담긴 오류로 화면에 보인다(지금 문구 그대로).
- [ ] 시험: 로그 받는 중 폴링이 2초 간격으로 최대 15번이다.
- [ ] 0117 브라우저 시험(`e2e/src/navigation.test.ts`)이 그대로 통과한다.

## 머지 위험

저장 형식은 바꾸지 않아 two-way다. 닿는 곳은 web(Runs, Run 상세)이다.
