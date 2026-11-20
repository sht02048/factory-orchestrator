---
status: done
blocked_by: [0124]
---

# 0126 Dashboard·Stats를 Query로

## 목표

Dashboard와 Stats를 Query로 옮기고, Dashboard의 15초 폴링을 변경 기록으로 바꾼다. 스펙 [0003](../spec/0003-query-cache.md) 4.3~4.5절, 운영자 결정 C4·C5·C6·C12.

## 배경

- Dashboard는 `home/refresh.ts`로 탭이 보일 때 15초마다 다시 읽는다. 결과는 라우터 캐시 밖 로컬 state에 담겨, 다른 화면에 갔다 오면 로더가 또 읽고 셸은 갱신하지 않는다(research [0016](../research/0016-web-data-loading.md) 4·9절).
- Stats는 머무는 동안 다시 읽지 않는다. 둘 다 시간대 쿠키로 결과가 바뀐다.

## 할 일

1. **query.** `["dashboard", ws, timeZone]`(`getHomePage`), `["stats", ws, days, timeZone]`(`getStatsPage`). 로더와 컴포넌트가 같은 `queryOptions`를 쓴다. 두 route에 `preloadStaleTime` 0을 준다.
2. **15초 폴링 지우기.** `home/refresh.ts`와 `_app/index.tsx`의 로컬 state(`polled`)를 지우고 Query와 변경 기록(0124)으로 갱신한다.
3. **멈추기·재개 처리 중.** 2초 다시 읽기를 `refetchInterval`로 옮긴다.
4. **mutation(C5).** Dashboard의 답하기, 거절, 멈추기와 재개. 0124가 만든 오류 타입과 변환 함수를 쓴다. 서버 함수는 바꾸지 않는다. 멈추기·재개의 `ok: false`는 지금처럼 "상태가 바뀜" 결과다(스펙 4.4, C5의 해석이라 시작할 때 운영자에게 확인한다). 성공하면 `["dashboard"]`와 그 런의 `["runs", ...]` key만 무효화한다. 멈추기·재개가 "상태가 바뀜"을 돌려줘도 지금처럼 같은 key를 무효화한다.
5. **시간대.** key에 넣어, `TimeZoneSync`의 `/_app/stats`·`/_app/` 필터 없이도 새로 읽게 한다. 루트 필터 정리는 0129가 한다.
6. 두 route에서 `router.invalidate()`를 지운다. 아직 옮기지 않은 화면도 바꾸는 쓰기는 옮기는 동안 그 route id만 고른 `router.invalidate({ filter })`를 함께 부른다(스펙 6절 3번).

## 완료 조건

- [x] 시험: 서버 렌더한 화면에서 hydration이 끝날 때까지 이 화면의 서버 함수를 다시 부르지 않는다.
- [x] 시험: mutation 하나 뒤 다시 읽는 서버 함수가 그 mutation이 바꾼 query뿐이다. 루트(`getTimeZone`, `getTitleBarHidden`)와 셸(`getShell`)은 다시 읽지 않는다(스펙 7절 2번의 예외 제외).
- [x] 시험: worker와 같은 함수로 런 상태를 바꾸면 열린 Dashboard가 3초 안에 바뀐다(15초 폴링 없이).
- [x] 시험: 러너가 Offline이 되면(`runner` 바뀜) Dashboard 러너 카드가 바뀐다.
- [x] 시험: SSE가 끊기면 열린 Dashboard가 30초마다 다시 읽는다(가짜 시계).
- [x] 시험: 시간대 쿠키가 바뀌면 Dashboard와 Stats가 새 시간대로 다시 읽는다.
- [x] `home/refresh.ts`와 그 시험을 지웠다.
- [x] 0117 브라우저 시험이 같은 뜻으로 통과한다(스펙 7절 5번).

## 확인 결과(2026-11-20)

### 만든 것

- **query.** `apps/web/src/home/query.ts`의 `dashboardQuery(ws, timeZone)`(`["dashboard", ws ?? null, timeZone]`), `apps/web/src/stats/query.ts`의 `statsQuery(ws, days, timeZone)`(`["stats", ws ?? null, days, timeZone]`). 로더는 `loadRouteQuery`(0123)로, 컴포넌트는 `useSuspenseQuery`로 같은 `queryOptions`를 쓴다. 두 route에 `preloadStaleTime: 0`을 주고 `shouldReload`는 두지 않는다.
- **시간대.** 로더는 `apps/web/src/query/request-time-zone.ts`의 `requestTimeZone`(서버는 요청 쿠키, 브라우저는 `document.cookie`를 서버 함수와 같은 `parseTimeZone`으로 읽는다)으로, 컴포넌트는 `useRequestTimeZone`(루트 로더의 `timeZone`을 구독해 다시 그리고 값은 같은 쿠키에서 읽는다)으로 key를 만든다. 같은 날 머지된 0125도 같은 파일을 만들어 0125의 API로 합쳤다. 한때 컴포넌트가 루트 로더 값을 key로 쓰게 바꿨지만(첫 방문 hydration 불일치를 줄이려고), 독립 interface-review가 그 방식에서도 불일치를 재현했고 `develop`(99b58b8)에서도 같아 원래 있던 문제로 보고 되돌렸다. 로더와 컴포넌트가 같은 쿠키를 읽으므로 시간대를 처음 맞추는 동안 이동해도 두 번 읽지 않는다. `TimeZoneSync`의 필터에서 `/_app/`·`/_app/stats`를 뺐다(루트만 남음, 정리는 0129).
- **한도가 풀릴 때.** 시간 글자를 클라이언트에서 흘리면 한도가 풀린 뒤에도 "0초 뒤 한도가 풀리면…"이 남는다(두 번째 interface-review의 LOW). 가장 먼저 풀리는 한도 시각 1초 뒤에 Dashboard query를 한 번 다시 읽어 서버 상태(풀린 한도는 빠짐)를 그린다.
- **15초 폴링을 지움.** `home/refresh.ts`와 그 시험, `_app/index.tsx`의 `polled` state를 지웠다. 갱신은 변경 기록 구독(0124)의 `["dashboard"]`·`["stats"]` 무효화, 끊겼을 때 30초 폴링, 창 포커스 다시 읽기가 맡는다.
- **시간 글자.** 15초 폴링은 "N분째", "N분 뒤 한도가 풀려요" 같은 서버가 계산한 시간도 새로 고치고 있었다(독립 interface-review가 찾은 Regression). `apps/web/src/home/aged-page.ts`의 `useAgedHomePage`가 받은 뒤 지난 시간만큼 지난 시간은 늘리고 남은 시간(러너 카드의 한도, 한도 때문에 기다리는 Queued 카드의 사유)은 줄여 15초마다 다시 그린다. 서버 왕복은 없다. Queued 사유는 독립 리뷰가 빠진 것을 찾았다.
- **멈추기·재개 처리 중.** `refetchInterval`이 처리 중인 요청이 있으면 2초, 없으면 끈다(`pollWhileControlPending`).
- **mutation.** `apps/web/src/home/mutations.ts`의 `useDashboardActions`. 답하기·거절은 `rejectedAs`(0124)로 이유가 담긴 `MutationRejectedError`가 되고, 멈추기·재개의 `ok: false`는 오류가 아니라 `"state-changed"` 결과다(코디네이터 승인). 성공하면 `["dashboard"]`, `["runs", "detail", runId]`, `["runs", "list"]`만 무효화하고, 아직 라우터 로더인 런 표시 route(`/_app/tickets`, `/_app/runners`, 0125 머지 전에는 Runs·Run 상세도)만 `router.invalidate({ filter })`로 고른다(스펙 6절 3번). 무효화 promise를 기다린 뒤 끝난다.
- **거절 이유 문구.** 이유가 있는 거절(이미 답함, 이미 거절함, 러너에서 처리함, 찾지 못함)은 다시 보내도 같은 실패라, 폼 대신 이유 문장을 `role="status"`로 남긴다(`home.json`의 `question.rejected`, `permission.rejected`). 거절 뒤 바로 다시 읽으면 Permission이 사라져 설명도 함께 사라지므로, 다시 읽기는 다른 곳의 쓰기가 남긴 변경 기록에 맡긴다.
- **0125와 맞춤.** 0125 머지 뒤 Dashboard 쓰기의 key는 0125의 `runDetailKey`·`runsListKey`를 쓴다. 0125 Run 상세 쓰기가 라우터로 다시 읽는 "아직 옮기지 않은 화면"(`MOVED_TO_QUERY_ROUTE_IDS`)에 `/_app/`·`/_app/stats`를 더했다.
- **`signal`을 넘기지 않음.** 0125가 찾은 대로 `queryFn`에 `signal`을 넘기면 개발 빌드(StrictMode 두 번 마운트)에서 다시 들어간 화면의 뒤 다시 읽기가 시작 직후 취소되고 30초 안이라 다시 읽지 않는다. 두 query에서 뺐고, 변경 기록 통로를 막은 채 다시 들어간 화면이 바뀐 상태를 그리는 시험 둘을 더했다. `signal`을 되돌리면 두 시험이 실패하는 것을 확인했다. 첫 '후' 측정이 30분 넘게 멈춘 것도 이 취소된 요청을 측정 도구가 기다려서였다.

### 0123 리뷰 MEDIUM(gcTime)

재현되지 않았다. 설치한 `router-core` 1.171.39의 match 캐시 기본값(`defaultGcTime`, `load-client.ts`의 `?? 3e5`)이 5분으로 Query `gcTime`과 같고, match의 `updatedAt`은 떠난 시각보다 앞이라 query가 지워질 때 match도 이미 지난 상태다. 가짜 시계로 6분 떠났다 돌아오는 브라우저 시험에서 Query 캐시는 비었고, 화면은 Runs에서 Dashboard·Stats로 빈 화면 없이 바뀌었다(route `gcTime`을 주지 않아도 같음). 공용 기본값은 바꾸지 않았고 회귀 시험만 남겼다.

### 같은 탭의 쓰기가 돌아옴(스펙 8절)

열린 Dashboard에서 멈추기·거절 하나마다 `getHomePage`가 mutation 무효화로 약 20ms 뒤 한 번, 변경 기록이 돌아와 약 0.65초 뒤 한 번 더 불렸다(세 번 재어 640, 654, 644ms). 0124 측정과 같은 한 번이라 줄이지 않는다.

### 측정(0122 스크립트, `MEASURE_RTT=0,100,200 MEASURE_REPEAT=3`, 개발 서버, 트래커 지연 500ms, 중앙값 ms)

| 왕복 | 회차  | 화면      |   전 |   후 | 이동 중 서버 함수(후)         |
| ---: | ----- | --------- | ---: | ---: | ----------------------------- |
|    0 | first | Dashboard |  107 |  120 | getHomePage                   |
|    0 | first | Stats     |  100 |  101 | getStatsPage                  |
|    0 | again | Dashboard |   81 |   82 | getHomePage(뒤에서)           |
|    0 | again | Stats     |   80 |   81 | getStatsPage(뒤에서)          |
|    0 | hover | Dashboard |   71 |   77 | -                             |
|    0 | hover | Stats     |   63 |   63 | -                             |
|  100 | first | Dashboard |  550 |  563 | requestRunLog ×2, getHomePage |
|  100 | first | Stats     |  416 |  412 | getStatsPage                  |
|  100 | again | Dashboard |   80 |   81 | getHomePage(뒤에서)           |
|  100 | again | Stats     |   84 |   82 | getStatsPage(뒤에서)          |
|  100 | hover | Dashboard |  242 |  239 | -                             |
|  100 | hover | Stats     |  119 |  126 | -                             |
|  200 | first | Dashboard | 1063 | 1048 | requestRunLog ×2, getHomePage |
|  200 | first | Stats     |  731 |  716 | getStatsPage                  |
|  200 | again | Dashboard |   84 |   81 | getHomePage(뒤에서)           |
|  200 | again | Stats     |   72 |   87 | getStatsPage(뒤에서)          |
|  200 | hover | Dashboard |  706 |  693 | -                             |
|  200 | hover | Stats     |  412 |  431 | -                             |

화면 이동 시간은 같은 수준이다(이 맥에 워커가 여럿 돌아 ±15ms는 흔들림). 0117 계약대로 다시 들어가면 기다리지 않고 그리고 뒤에서 한 번 읽는다. Dashboard 첫 방문의 `requestRunLog`는 측정 순서상 앞 화면(Run 상세)의 것이다. 이 티켓이 줄이는 것은 이동 시간이 아니라 머무는 동안의 읽기(15초마다 `getHomePage` → 바뀔 때만)와 쓰기 뒤 루트·셸 다시 읽기(`getTimeZone`, `getTitleBarHidden`, `getShell`, Dashboard 전체 로더 → `getHomePage` 하나)다.

### 시험

- `e2e/src/dashboard-query.test.ts`(브라우저 20개): hydration 동안 서버 함수 0번(Dashboard, Stats), 답하기·거절 뒤 `[쓰기, getHomePage]`만, 멈추기 뒤 2초 다시 읽기와 끝나면 멈춤, "상태가 바뀜"도 같은 key만, 거절 이유 문장 둘, worker 함수로 런 상태를 바꾸면 3초 안, 러너 Offline, SSE가 끊기면 30초마다(가짜 시계), 변경 기록 통로를 막은 채 다시 들어간 Dashboard·Stats, 시간 글자가 서버 왕복 없이 흐름, 시간대 쿠키가 바뀌면 새 시간대로 한 번 다시 읽고 화면을 비우지 않음(Dashboard, Stats), 6분 떠났다 돌아와도 빈 화면 없음(Dashboard, Stats).
- 시간대 쿠키가 없는 첫 방문에 hydration 불일치가 없다(Dashboard, Stats). 이 맥에서는 고치기 전 방식에서도 재현되지 않아 회귀 방지용이다.
- 단위: `home/query.test.ts`(key와 2초 다시 읽기), `home/aged-page.test.ts`(시간 흘리기, 가장 먼저 풀리는 한도), `home/rejection.test.ts`.
- 전체 e2e(PR 전 한 번): 197개 가운데 195개 통과. 실패 둘(`runner-setup.test.ts` "직접 입력으로 등록하면…", `settings.test.ts` "목차를 누르면…")은 이 티켓이 닿지 않는 화면이고 단독으로 다시 돌리면 통과했다(러너 설정은 파일 전체 16개 통과, 시험 순서에 기대어 `-t`로 하나만 돌리면 실패). 부하로 흔들린 것으로 본다(0131).
- `e2e/src/home.test.ts`의 "다시 읽기가 실패해도 열린 패널과 쓰던 답을 그대로 둔다"는 15초 폴링 대신 변경 기록이 일으킨 다시 읽기를 실패시키도록 바꿨다(같은 뜻).

## 머지 위험

저장 형식은 바꾸지 않아 two-way다. 닿는 곳은 web(Dashboard, Stats)이다.
