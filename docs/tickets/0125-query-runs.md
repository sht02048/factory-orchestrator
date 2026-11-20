---
status: doing
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
3. **mutation(C5).** 답하기, 거절, 취소, 멈추기와 재개, 로그 다시 받기. 서버 함수는 바꾸지 않는다. `mutationFn`이 0124의 변환 함수로 `{ ok: false, reason }`과 `answerQuestion`·`denyPermission`이 throw한 오류를 이유가 담긴 오류 타입으로 바꾼다. `expectOk`를 지운다. 멈추기·재개(`controlRun`)의 `ok: false`는 지금처럼 오류가 아니라 "상태가 바뀜" 결과로 화면에 돌려준다(스펙 4.4, C5의 해석이라 시작할 때 운영자에게 확인한다). 성공하면 `["runs", "detail", runId]`와 `["runs", "list"]`만 무효화한다. 멈추기·재개가 "상태가 바뀜"을 돌려줘도 지금처럼 그 런의 key를 무효화한다. 로그 다시 받기(`requestRunLog`, boolean을 돌려준다)는 `["runs", "detail", runId]`만 무효화한다.
4. **열 때 로그 요청.** `requestRunLog` 뒤에 `["runs", "detail", runId]`만 무효화한다(지금은 화면 전체).
5. **처리 중 폴링.** 로그 받는 중(2초, 최대 15번)과 멈추기·재개 처리 중(2초)을 그 query의 `refetchInterval`로 옮긴다.
6. **구독 연결.** 0124의 구독 모듈이 `run`·`assignment` 바뀜에 이 key들을 무효화하는지 화면에서 확인한다.
7. 두 route에서 `router.invalidate()`를 지운다. 아직 옮기지 않은 화면도 바꾸는 쓰기는 옮기는 동안 그 route id만 고른 `router.invalidate({ filter })`를 함께 부른다(스펙 6절 3번).

## 완료 조건

- [x] 시험: 서버 렌더한 화면에서 hydration이 끝날 때까지 이 화면의 서버 함수를 다시 부르지 않는다.
- [x] 시험: mutation 하나 뒤 다시 읽는 서버 함수가 그 mutation이 바꾼 query뿐이다. 루트(`getTimeZone`, `getTitleBarHidden`)와 셸(`getShell`)은 다시 읽지 않는다(스펙 7절 2번의 예외 제외).
- [x] 시험: worker와 같은 함수로 런 상태를 바꾸면 열린 Runs와 Run 상세가 3초 안에 바뀐다.
- [x] 시험: SSE가 끊기면 열린 Run 상세가 30초마다 다시 읽는다(가짜 시계).
- [x] 시험: 시간대 쿠키가 바뀌면 Runs가 새 시간대로 다시 읽는다.
- [x] 시험: `ok: false` 결과가 이유가 담긴 오류로 화면에 보인다(지금 문구 그대로).
- [x] 시험: 로그 받는 중 폴링이 2초 간격으로 최대 15번이다.
- [x] 0117 브라우저 시험(`e2e/src/navigation.test.ts`)이 같은 뜻으로 통과한다(스펙 7절 5번).

## 확인 결과(2026-11-20)

### 만든 것

- `apps/web/src/runs/queries.ts`: `runsListQuery`(key `["runs", "list", { ws, ended, ...conditions }, timeZone]`, `ws`가 없으면 빈 값), `runDetailQuery`(key `["runs", "detail", runId]`). 로더와 컴포넌트가 같은 `queryOptions`를 쓴다. 두 route에 `preloadStaleTime: 0`을 주고 `shouldReload`는 두지 않는다(0123).
- `apps/web/src/query/request-time-zone.ts`(공용에 새로 더함): `requestTimeZone`은 서버에서는 요청 쿠키, 브라우저에서는 `document.cookie`의 시간대를 루트 로더와 같은 `parseTimeZone`으로 읽는다. 로더가 루트 로더의 값을 받을 길이 없어 쿠키를 직접 읽는다. `useRequestTimeZone`은 같은 값을 돌려주고 루트 로더의 시간대를 구독해, `TimeZoneSync`가 쿠키를 바꾸고 루트를 다시 읽으면 Runs가 다시 그려져 새 key로 읽는다. Runs는 이 값을 `useDeferredValue`로 받아 key가 바뀌는 동안 지난 목록을 그대로 보인다. 처음에는 컴포넌트가 루트 로더 값을 썼는데, 시간대를 막 정한 첫 방문(100ms 왕복)에서 루트가 아직 다시 읽는 중이라 로더(새 시간대)와 컴포넌트(옛 시간대)의 key가 갈려 `getRunsPage`를 두 번 불렀다. 둘 다 쿠키를 읽게 해 한 번이 됐다.
- `apps/web/src/run-detail/actions.ts`: 답하기·거절·취소·멈추기와 재개·로그 다시 받기·열 때 로그 요청의 `mutationOptions`와 `useRunDetailMutations`. `expectOk`를 지웠다.
  - 답하기·거절은 0124의 `rejectedAs`로 throw한 오류를, 취소는 `okOrThrow`로 `{ ok: false, reason }`을 `MutationRejectedError`(이유 담김)로 바꾼다. 화면은 지금처럼 실패 문구(`run.actionFailed`)를 보인다.
  - 멈추기·재개의 `ok: false`는 오류가 아니라 `"state-changed"`로 돌려주고(C5의 해석, 코디네이터 승인), 그래도 그 런의 key를 무효화한다.
  - 성공하면 `["runs", "detail", runId]`와 `["runs", "list"]`만 무효화하고, 무효화 promise를 기다려 다시 읽기가 끝날 때까지 pending이다. 로그 다시 받기와 열 때 로그 요청(요청이 남았을 때만)은 `["runs", "detail", runId]`만 무효화한다.
  - 아직 옮기지 않은 화면도 바꾸는 쓰기(답하기·거절·취소·멈추기와 재개)는 `router.invalidate({ filter })`를 함께 부른다(스펙 6절 3번). 고르는 기준은 "루트, `/_app`(셸), Runs, Run 상세가 아닌 route"다. 0126·0127이 함께 옮기는 중이라 이름을 적어 두면 머지 순서마다 낡기 때문이다. 옮긴 route가 골라져도 그 match는 다음에 들어갈 때 로더가 어차피 돌아 해가 없다. 0129가 이 호출을 지운다.
- 처리 중 폴링은 Run 상세 query의 `refetchInterval`이다(`runDetailPollMs`). 멈추기·재개 처리 중이면 2초마다 끝날 때까지, 로그 받는 중이면 2초마다 최대 15번. 15번은 로그를 요청하고 무효화가 끝난 때의 그 query 읽기 수(`dataUpdateCount + errorUpdateCount`)부터 센다. 그래서 변경 기록이 그사이 다시 읽게 한 것도 한 번으로 친다.
- Run 상세 컴포넌트는 `runId`를 `key`로 다시 마운트한다. 같은 티켓의 다른 런으로 옮기면 로그 요청과 폴링 수를 그 런으로 새로 센다.
- 두 route에서 `router.invalidate()`를 지웠다. 로그 요청 뒤와 로그·멈추기 폴링의 화면 전체 다시 읽기가 없어졌다.

### `signal`을 넘기지 않는다

0123의 사용 예처럼 `queryFn: ({ signal }) => fn({ data, signal })`로 쓰면, 다시 들어간 화면의 `loadRouteQuery` 뒤 다시 읽기가 시작 1ms 뒤 `net::ERR_ABORTED`로 취소되고 다시 읽지 않았다(개발 서버, 100ms 왕복). 컴포넌트가 마운트되며 관찰자가 잠깐 0이 될 때(개발 빌드의 이중 마운트) query-core가 `signal`을 쓴 읽기를 `cancel({ revert: true })`로 되돌리고, 데이터가 30초 안이라 다시 붙은 관찰자도 다시 읽지 않아서다. 0117 시험은 그 뒤 변경 기록 SSE가 다시 읽어 줘 가려졌다. 그래서 Runs·Run 상세의 `queryFn`은 `signal`을 넘기지 않는다. 통로를 막은 채 "다시 들어간 Runs가 그사이 바뀐 상태를 그린다" 브라우저 시험을 더했고, `signal`을 되돌리면 이 시험이 실패하는 것을 확인했다. 코디네이터에게 0126·0127 영향으로 알렸다.

같은 원인으로 0117 도우미 `navigateByRail`(`e2e/src/navigation-timing.ts`)이 취소된 요청의 `request.response()`를 끝없이 기다려 `navigation.test.ts`의 "다시 들어간 화면은 그사이 바뀐 런 상태를 반영한다"가 60초에 시간이 다 됐다(다시 들어간 Runs의 뒤 다시 읽기를 변경 기록의 무효화가 취소하고 새로 읽을 때). 도우미가 `requestfinished`·`requestfailed` 가운데 먼저 온 것을 끝으로 보게 고쳤다. 기대는 바꾸지 않았다.

### gcTime 5분(0123 독립 리뷰 MEDIUM)

재현되지 않았다. 가짜 시계(Playwright `clock`)로 Runs와 Run 상세를 각각 연 뒤 Dashboard로 옮기고 6분을 보내 Query 캐시가 비었음(`getQueryCache().getAll()`이 빈 배열)을 확인한 다음, 레일 링크를 누르는 경우와 미리 읽기 없이 `router.navigate`로 돌아오는 경우 모두 화면 본문이 비는 순간이 없었고(`MutationObserver`로 확인) 대체 화면 없이 그렸다. 탐침 시험은 커밋하지 않았다. 공용 기본값은 바꾸지 않았다.

### 구독 연결

0124의 구독 모듈이 `run`·`assignment` 줄에 `["runs", "detail"]`·`["runs", "list"]`를 무효화해 열린 Runs와 Run 상세가 3초 안에 바뀐다(브라우저 시험). 로그 줄(`part: "log"`)은 그 런의 상세만 무효화한다. 같은 탭의 쓰기가 돌아오는 횟수: 취소 하나 뒤 mutation이 `getRunDetail`을 한 번 다시 읽고, 0.1~1.0초 뒤 변경 기록으로 한 번 더 읽는다(1012ms, 109ms, 409ms 뒤). 0124 측정과 같은 정도라 그대로 둔다(스펙 8절에 적음).

### 오류 화면(스펙 열린 질문 4)

코디네이터 결정(2026-11-20): route별 `errorComponent`를 두지 않고 지금 동작 그대로 둔다. `_app` 안 공용 오류 화면은 0129가 맡는다. 스펙 0003 열린 질문 4에 적었다.

### 시험

- `apps/web/src/run-detail/actions.test.ts`(12개): 성공한 mutation마다 무효화한 key가 그 런의 상세와 Runs 목록뿐(Dashboard·Tickets·Runners·Stats·셸·다른 런 상세는 그대로), 취소의 `ok: false`와 답하기·거절이 throw한 이유가 `MutationRejectedError`의 `reason`으로 남음, 멈추기의 `ok: false`는 `"state-changed"`이고 두 key를 무효화, 로그 다시 받기와 열 때 로그 요청은 상세만, 아직 옮기지 않은 화면 고르기, 로그 받는 중 폴링이 2초 간격 15번(가짜 시계, `QueryObserver`), 로그가 오면 멈춤, 멈추기·재개 처리 중은 15번 제한 없이 끝날 때까지.
- `e2e/src/runs-query.test.ts`(브라우저 7개): hydration 동안 `getRunsPage`·`getRunDetail`을 부르지 않음(Run 상세는 열 때 로그 요청만), 취소 뒤 서버 함수가 `cancelRun`, `getRunDetail`뿐이고 루트·셸 함수가 없음(통로를 막음), 로그 다시 받기 뒤 `requestRunLog`·`getRunDetail`뿐, worker와 같은 함수로 런 상태를 바꾸면 Runs와 Run 상세가 3초 안에 바뀜, 통로 없이도 다시 들어간 Runs가 새로 읽음, 통로가 끊기면 Run 상세를 30초마다 다시 읽음(가짜 시계), 시간대 쿠키가 바뀌면 Runs가 새 시간대 쿠키로 다시 읽음.
- 기존 `run-detail.test.ts`의 "요청을 남기지 못하면 실패 문구가 role=alert 로 보인다"가 `ok: false` → 이유가 담긴 오류 → 지금 문구 그대로를 브라우저에서 확인한다.
- 0117 `navigation.test.ts` 8개가 기대를 바꾸지 않고 통과한다.

### 측정(0117·0122 측정 스크립트)

`e2e/src/remote-navigation.measure.ts`(개발 서버, 느린 트래커 500ms, `MEASURE_RTT=0,100`, 세 번의 중앙값)를 전(`develop` 99b58b8)과 후에 같은 맥에서 돌렸다. 서버 함수 열은 첫 반복의 것이다. 다른 워커 넷이 함께 도는 맥이라 수십 ms의 차이는 잡음이다. Runs의 이동 시간과 서버 함수 수는 같다. 100ms 왕복의 첫 Dashboard 이동에 보이는 `requestRunLog` 두 번은 시작 화면(없는 런의 Run 상세)의 열 때 로그 요청이 개발 빌드의 이중 마운트로 두 번 도는 것으로, 전과 같다.

| 왕복(ms) | 회차  | 화면      | 전 ms | 후 ms | 전: 누르는 동안 서버 함수                                  | 후: 누르는 동안 서버 함수                                   |
| -------: | ----- | --------- | ----: | ----: | ---------------------------------------------------------- | ----------------------------------------------------------- |
|        0 | first | dashboard |   115 |   105 | getHomePage 11ms                                           | getHomePage 18ms                                            |
|        0 | first | tickets   |   100 |   100 | getTicketsPage 8ms                                         | getTicketsPage 10ms                                         |
|        0 | first | runs      |   100 |   100 | getRunsPage 10ms                                           | getRunsPage 5ms                                             |
|        0 | first | runners   |   104 |    99 | getRunnersPage 13ms                                        | getRunnersPage 13ms                                         |
|        0 | first | stats     |   100 |   102 | getStatsPage 7ms                                           | getStatsPage 11ms                                           |
|        0 | first | settings  |   100 |   101 | getSettingsPage 8ms                                        | getSettingsPage 9ms                                         |
|        0 | again | dashboard |    83 |    81 | getHomePage 1ms                                            | getHomePage 4ms                                             |
|        0 | again | tickets   |    87 |    66 | getTicketsPage 13ms                                        | getTicketsPage 7ms                                          |
|        0 | again | runs      |    84 |    83 | getRunsPage 0ms                                            | getRunsPage 2ms                                             |
|        0 | again | runners   |    82 |    83 | getRunnersPage 0ms                                         | getRunnersPage 1ms                                          |
|        0 | again | stats     |    84 |    84 | getStatsPage 1ms                                           | getStatsPage 1ms                                            |
|        0 | again | settings  |    99 |    99 | getSettingsPage 1ms                                        | getSettingsPage 2ms                                         |
|        0 | hover | dashboard |    61 |    75 | -                                                          | -                                                           |
|        0 | hover | tickets   |    77 |    78 | -                                                          | -                                                           |
|        0 | hover | runs      |    67 |    62 | -                                                          | -                                                           |
|        0 | hover | runners   |    60 |    66 | getRunnersPage 2ms                                         | getRunnersPage 0ms                                          |
|        0 | hover | stats     |    63 |    67 | -                                                          | -                                                           |
|        0 | hover | settings  |    66 |    74 | -                                                          | -                                                           |
|      100 | first | dashboard |   550 |   552 | requestRunLog 96ms, requestRunLog 111ms, getHomePage 110ms | requestRunLog 104ms, requestRunLog 103ms, getHomePage 125ms |
|      100 | first | tickets   |   413 |   416 | getTicketsPage 110ms                                       | getTicketsPage 109ms                                        |
|      100 | first | runs      |   298 |   299 | getRunsPage 106ms                                          | getRunsPage 109ms                                           |
|      100 | first | runners   |   533 |   520 | getRunnersPage 110ms                                       | getRunnersPage 109ms                                        |
|      100 | first | stats     |   414 |   401 | getStatsPage 103ms                                         | getStatsPage 101ms                                          |
|      100 | first | settings  |   298 |   299 | getSettingsPage 109ms                                      | getSettingsPage 109ms                                       |
|      100 | again | dashboard |    79 |    81 | getHomePage 98ms                                           | getHomePage 100ms                                           |
|      100 | again | tickets   |    80 |    83 | getTicketsPage 97ms                                        | getTicketsPage 96ms                                         |
|      100 | again | runs      |    85 |    85 | getRunsPage 94ms                                           | getRunsPage 95ms                                            |
|      100 | again | runners   |    77 |    85 | getRunnersPage 93ms                                        | getRunnersPage 98ms                                         |
|      100 | again | stats     |    82 |    83 | getStatsPage 97ms                                          | getStatsPage 103ms                                          |
|      100 | again | settings  |    71 |    72 | getSettingsPage 89ms                                       | getSettingsPage 87ms                                        |
|      100 | hover | dashboard |   246 |   256 | -                                                          | -                                                           |
|      100 | hover | tickets   |   114 |   126 | -                                                          | -                                                           |
|      100 | hover | runs      |    64 |    84 | -                                                          | -                                                           |
|      100 | hover | runners   |   234 |   243 | getRunnersPage 156ms                                       | getRunnersPage 162ms                                        |
|      100 | hover | stats     |   115 |   117 | -                                                          | -                                                           |
|      100 | hover | settings  |    59 |    80 | -                                                          | -                                                           |

## 머지 위험

저장 형식은 바꾸지 않아 two-way다. 닿는 곳은 web(Runs, Run 상세)이다.
