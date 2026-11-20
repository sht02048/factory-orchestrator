---
status: done
blocked_by: [0122, 0125, 0126, 0127, 0128]
---

# 0129 Query 이행 정리와 다시 재기

## 목표

`_app`의 데이터 화면을 모두 옮긴 뒤 라우터 쪽 남은 캐시 설정과 `router.invalidate()`를 지우고, 화면 이동을 다시 재어 전·후를 남긴다. 스펙 [0003](../spec/0003-query-cache.md) 1·6·7절, 운영자 결정 C6·C13.

## 할 일

1. `apps/web/src`에 남은 `router.invalidate()`를 지운다. 루트(`routes/__root.tsx`), 온보딩(`routes/onboarding.tsx`와 그것이 넘기는 저장 뒤 동작), 온보딩이 넘기는 러너 설정 동작의 것은 남긴다(C1). Runners가 쓰는 러너 설정 동작은 0127이 key 무효화로 바꿨다. 루트 `TimeZoneSync`의 필터는 루트만 남긴다(화면은 시간대가 든 key로 새로 읽는다).
2. 라우터 전역 `defaultPreloadStaleTime`을 0으로 바꾸고(C6), 화면마다 준 `preloadStaleTime`을 지운다. `PRELOAD_FRESH_MS`는 로더의 "방금 읽음" 기준(스펙 4.2)이 계속 쓰므로 query 기본값 모듈로 옮긴다(이름은 바꿔도 된다). 루트의 `shouldReload: false`는 그대로 둔다(C1). 0127이 `reloadOnEnter`와 `_app`의 것을 정리했으므로 지울 `shouldReload`가 남지 않았는지 확인한다. 전역 0이 라우터 로더로 남는 온보딩 route의 미리 읽기를 바꾸지 않는지(포인터를 올릴 때마다 서버 함수를 더 부르지 않는지) 확인한다.
3. ADR [0019](../adr/0019-query-cache-and-change-events.md)와 스펙 0003을 실제 결과에 맞춰 고친다(정한 로더 API, key 모양, 탭 여러 개 결정).
4. 0117 측정(`e2e/src/measure-navigation.ts`)과 0122의 원격 지연 측정을 돌려 전·후 표를 이 티켓에 남긴다. "전"은 0125~0127 가운데 처음 머지된 것 바로 앞의 `develop` 커밋이다(0123·0124는 화면을 옮기지 않는다). 그 커밋을 빌드해 띄우고 이 티켓 head의 측정 스크립트로 잰다. "후"는 이 티켓의 head다. "전" 커밋에 0122가 들어 있는지 적고, 들어 있지 않으면 0122 머지 직후 값을 따로 한 줄 남겨 Query의 효과와 0122의 효과를 나눠 보인다.
5. 남은 폴링을 정리한다. 0124의 30초 대비와 query `refetchInterval` 말고는 화면 폴링이 없어야 한다(온보딩·러너 설정 흐름의 것은 남긴다).

## 완료 조건

- [x] `rg "\.invalidate\(" apps/web/src`(줄이 나뉜 호출도 찾도록)에 루트·온보딩·온보딩의 러너 설정 흐름의 것만 남았다. 운영자 결정(2026-11-20, 0129)으로 서버를 다시 읽지 않는 두 곳(Settings 상세의 문서 제목 따라가기, 셸 안 오류 화면의 다시 읽기)은 예외로 남긴다. 아래 「남긴 라우터 다시 읽기」.
- [x] 스펙 0003 7절의 다섯 시험이 모든 `_app` 화면에서 통과한다.
- [x] 0117 브라우저 시험이 같은 뜻으로 통과한다(스펙 7절 5번).
- [x] 전·후 측정 표(같은 기기, 원격 지연)를 이 티켓에 적었다.
- [x] ADR 0019와 스펙 0003을 고쳤다.

## 확인 결과(2026-11-20)

### 바꾼 것

- **쓰기 뒤 라우터 다시 읽기를 지웠다.** Run 상세(`run-detail/actions.ts`의 `refreshUnmovedScreens`, `MOVED_TO_QUERY_ROUTE_IDS`)와 Dashboard(`home/mutations.ts`의 `ROUTER_ROUTES_SHOWING_RUNS`)의 답하기·거절·취소·멈추기와 재개가 함께 부르던 `router.invalidate({ filter })`를 지웠다. 0127·0128 뒤 그 route들도 query로 읽어, 라우터 다시 읽기는 캐시만 다시 읽어 아무것도 새로 받지 못하고 있었다. 대신 두 화면이 같은 `keysChangedByRunWrite(runId)`(`runs/queries.ts`)로 그 런의 상세, Runs 목록, Dashboard, Stats, Tickets의 DB 부분, Runners, Settings를 무효화한다. 보이지 않는 key는 stale 표시만 된다. Dashboard 쓰기는 지금까지 Stats를 무효화하지 않았는데 이제 한다.
- **셸을 셸 query로 읽는다.** Runs·Stats가 `_app` 로더 데이터(`getRouteApi("/_app").useLoaderData()`)로 읽던 Workspace 목록을 `useShell()`로 바꿨다. 로더 데이터는 로더가 돌던 때의 값이라 셸 query가 다시 읽혀도 두 화면의 Workspace 고르기가 낡아 있었다.
- **미리 읽기 신선도.** 라우터 전역 `defaultPreloadStaleTime`을 0으로 바꾸고 `_app` route 열 곳과 시험용 route의 `preloadStaleTime: 0`을 지웠다. `PRELOAD_FRESH_MS`(5초)는 `query/query-client.ts`로 옮겼다. 라우터 로더로 남은 온보딩 route는 Settings의 "Workspace 만들기" 링크가 미리 읽으므로 route에 `preloadStaleTime: PRELOAD_FRESH_MS`를 남겨 포인터를 올릴 때마다 `getOnboardingPage`를 다시 부르지 않게 했다(지금까지와 같은 5초). 루트의 `shouldReload: false`는 그대로이고 다른 `shouldReload`는 남지 않았다.
- **셸 안 공용 오류 화면(스펙 0003 열린 질문 4, 0125에서 넘어옴).** `shell/screen-error.tsx`를 `_app` 아래 화면 route 열 곳의 `errorComponent`로 둔다. 서버 렌더와 hydration 뒤 모두 레일이 남고 화면 칸에 "화면을 열지 못했어요", 복구 안내, "다시 읽기" 단추가 보인다. 오류 화면이 뜨면 머리로 포커스를 옮겨 화면 읽기 프로그램이 알린다. 다시 읽기는 실패한 match만 다시 돌린다. 그동안 포커스는 단추에 있고, 또 실패하면 "다시 읽지 못했어요…"(`role="status"`) 문장으로 포커스를 옮겨 읽히게 한다. 성공하면 단추가 사라지므로 포커스를 레일의 지금 화면 링크로 옮긴다. 다시 읽는 동안 라우터가 오류 경계를 다시 그려 오류 화면이 두세 번 다시 마운트되고 그때마다 새 단추로 포커스를 다시 준다(interface-review LOW, 화면 읽기가 "다시 읽는 중…"을 여러 번 읽을 수 있음). 경계를 다시 그리지 않게 하려면 라우터 오류 경계를 우회해야 해 남겼다. 이 실패 문장은 다른 화면으로 옮기면 걷힌다. 셸 자신(`getShell`)이 실패하면 레일을 그릴 수 없어 지금처럼 루트 `RootError`가 대신한다. 문구는 `messages/ko/shell.json`의 `screenError`.
- **문서.** ADR 0019(로더 API, `_app` 안의 라우터 다시 읽기, 오류 화면, 숨은 탭의 SSE)와 스펙 0003(4.2 로더 API와 온보딩 미리 읽기, 4.3 실제 key 표, 6절 5번 결과와 예외, 7절 전체 확인, 열린 질문 4 결과)을 고쳤다.

### 남긴 라우터 다시 읽기

`rg -U "\.invalidate\(" apps/web/src`(시험 빼고)에 남은 것:

- `routes/__root.tsx` `TimeZoneSync`: 루트만(C1).
- `settings/use-settings-actions.ts` `useSettingsReload`: 온보딩만 쓴다(`routes/onboarding.tsx`). 온보딩의 러너 점검 기다림(`pollRunnerChecks`)도 이것을 탄다.
- `settings/route-title.ts` `useTitleFollowsQuery`(예외): Settings 연결 상세·프로젝트 상세의 문서 제목. 라우터 `head`는 로더가 돌 때만 다시 계산되어 이름이 바뀌면 그 route 하나만 다시 읽는다. 로더는 query 캐시만 읽어(`staleTime: "static"`, 원인 `stay`라 뒤 읽기 없음) 서버 왕복이 없다. 시험: `e2e/src/settings-query.test.ts` "연결 이름을 바꾸면 제목과 문서 제목이 함께 바뀐다".
- `shell/screen-error.tsx`(예외): 실패한 match만 고른 다시 읽기. 로더가 실패한 match는 라우터가 다시 돌리기 전까지 오류로 남는다. 시험: `e2e/src/query-cache.test.ts` "다시 읽기를 누르면 실패했던 화면만 다시 읽고…"(그동안 루트·셸 서버 함수 0번).
- `change-events/channel.ts:158`의 `target.invalidate(keys)`는 라우터가 아니라 변경 기록 구독의 query key 무효화다.

### 남은 폴링(할 일 5)

0124의 30초 대비(`change-events/channel.ts`), Run 상세 로그·멈추기 처리 중과 Dashboard 멈추기 처리 중의 `refetchInterval`, Runners의 러너 점검 끝 기다림만 남았다. Runners의 것은 0127이 만든 대로 작은 query(`["runners", "checks-pending"]`)를 3초마다 읽고 점검이 끝나거나 제한 시간이 지나면 멈춘다. `refetchInterval`이 아니라 온보딩과 함께 쓰는 `useRunnerCheckPolling`의 타이머가 그 query를 부른다. 온보딩의 러너 점검 기다림과 러너 설정 흐름의 상태 읽기(`runner-setup/runner-setup.tsx`)는 C1대로 둔다. 그 밖의 `setInterval`·`setTimeout`은 화면 시각 흘리기(`home/aged-page.ts`, `push-check.tsx`, `runner-setup/enrollment.tsx`), 알림 문장 걷기, 서버 쪽 SSE다.

### 잰 결과

"전"은 `develop` 37236e4(0125 머지 48ba34f 바로 앞, 0131 머지)다. 0122(623f66f)가 들어 있어 따로 줄을 두지 않는다. 두 커밋 모두 이 티켓 head의 측정 스크립트로 쟀다. "전" 쪽에는 head의 `e2e/src/navigation-timing.ts`(서버 함수 시간 세기 고침)를 넣어 같은 방식으로 쟀다. 같은 맥, 3번 중앙값(ms), 왕복은 Chrome이 요청마다 더한 지연이다. 이 맥에 다른 워커가 함께 돌아 ±15ms 안팎은 흔들림이다.

프로덕션 빌드(`pnpm --filter @ganger/web build`, `pnpm dev`가 만든 시드 DB, `node e2e/src/measure-navigation.ts --rtt 0,100,200 --repeat 3`). 실제 어댑터라 시드의 트래커 연결이 가짜 키로 Linear를 불러 실패한다(약 450ms, 실패는 서버에 담지 않아 매번 기다린다).

| 왕복 | 경우                      | Dashboard |   Tickets |      Runs |   Runners |     Stats |  Settings |
| ---: | ------------------------- | --------: | --------: | --------: | --------: | --------: | --------: |
|    0 | 첫 방문, 바로 누름        |   95 → 99 | 539 → 538 |  97 → 100 |   96 → 98 | 100 → 100 | 531 → 520 |
|    0 | 다시 들어가기             |   64 → 80 |   67 → 66 |   88 → 83 |   75 → 66 |   67 → 67 |   66 → 67 |
|    0 | 첫 방문, 300ms 올려 둔 뒤 |   71 → 68 | 265 → 231 |   64 → 68 |   63 → 61 |   45 → 48 | 365 → 256 |
|  100 | 첫 방문, 바로 누름        | 226 → 232 | 519 → 517 | 200 → 201 | 185 → 185 | 180 → 197 | 567 → 550 |
|  100 | 다시 들어가기             |   66 → 78 |   57 → 58 |   62 → 68 |   76 → 69 |   62 → 68 |   56 → 52 |
|  100 | 첫 방문, 300ms 올려 둔 뒤 |   72 → 82 | 230 → 227 |   64 → 61 |   60 → 62 |   48 → 58 | 248 → 267 |
|  200 | 첫 방문, 바로 누름        | 436 → 432 | 517 → 532 | 280 → 284 | 286 → 281 | 299 → 286 | 534 → 529 |
|  200 | 다시 들어가기             |   62 → 63 |   55 → 41 |   62 → 75 |   56 → 57 |   52 → 73 |   51 → 68 |
|  200 | 첫 방문, 300ms 올려 둔 뒤 |   70 → 72 | 317 → 251 |   56 → 79 |   48 → 44 |   45 → 59 | 249 → 285 |

개발 서버, 트래커 읽기마다 500ms(`MEASURE_RTT=0,100,200 MEASURE_TRACKER_DELAY=500 pnpm exec vitest run -c e2e/vitest.measure.config.ts`, 0122 방식).

| 왕복 | 경우                      |  Dashboard |   Tickets |      Runs |   Runners |     Stats |  Settings |
| ---: | ------------------------- | ---------: | --------: | --------: | --------: | --------: | --------: |
|    0 | 첫 방문, 바로 누름        |  125 → 116 |   98 → 99 | 102 → 100 |  104 → 99 | 100 → 102 |   98 → 98 |
|    0 | 다시 들어가기             |    83 → 78 |   66 → 66 |   83 → 84 |   83 → 83 |   84 → 84 | 101 → 100 |
|    0 | 첫 방문, 300ms 올려 둔 뒤 |    85 → 74 |   76 → 78 |   66 → 66 |   68 → 77 |   66 → 73 |   79 → 82 |
|  100 | 첫 방문, 바로 누름        |  546 → 515 | 401 → 402 | 300 → 297 | 619 → 514 | 417 → 413 | 314 → 304 |
|  100 | 다시 들어가기             |    82 → 81 |   75 → 74 |   82 → 75 |   84 → 82 |   85 → 73 |   81 → 90 |
|  100 | 첫 방문, 300ms 올려 둔 뒤 |  244 → 245 | 110 → 128 |   62 → 78 | 225 → 229 | 114 → 114 |   64 → 80 |
|  200 | 첫 방문, 바로 누름        | 1068 → 917 | 717 → 719 | 500 → 501 | 917 → 918 | 715 → 715 | 500 → 500 |
|  200 | 다시 들어가기             |    83 → 81 |   65 → 81 |   80 → 68 |   81 → 82 |   82 → 73 |   83 → 72 |
|  200 | 첫 방문, 300ms 올려 둔 뒤 |  694 → 641 | 414 → 427 | 211 → 209 | 830 → 836 | 414 → 428 | 228 → 227 |

- 화면 이동 시간은 두 방식 모두 흔들림 안에서 같다. 0122가 이미 이동 왕복을 줄였고, 0125~0129는 이동이 아니라 머무는 동안과 쓰기 뒤에 다시 읽는 범위를 좁히는 일이다.
- 다시 들어갈 때 뒤에서 새로 읽는 것이 줄었다. 프로덕션의 Tickets는 트래커까지 다시 읽던 `getTicketsPage`(427~465ms)에서 DB 부분 `getTicketRuns`(6~208ms)로, Settings는 `getSettingsPage`(431~610ms)에서 `getSettings`(6~201ms)로 바뀌었다. 트래커 query는 다시 들어가도 5분을 지킨다(0127 결정 A).
- 포인터를 올려 미리 읽은 뒤 누른 Runners는 지금까지 들어갈 때 `getRunnersPage`를 한 번 더 읽었고(`reloadOnEnter`, 왕복 200에서 355ms), 이제 더 읽지 않는다.
- 왕복 100의 개발 서버 Runners 첫 방문(619 → 514)과 왕복 200의 Dashboard 첫 방문(1068 → 917)은 개발 서버의 화면 코드 받기 차이로 보고 효과로 치지 않는다. 프로덕션에서는 같다.

### 흔들리는 시험 점검

- `e2e/src/settings.test.ts` '맞지 않는 분 값은…'(PR #173 CI 30초 초과)은 0136이 이미 지웠다.
- 0125~0128 Query 브라우저 시험의 CI 기록(`gh run list --workflow CI`, 2026-11-20 03:00 UTC 뒤 실패 넷)은 모두 `dashboard-query.test.ts` "SSE가 끊기면 열린 Dashboard가 30초마다…"의 `getShell` 두 번이었다. 0126과 0127이 엇갈려 생긴 결정적 실패이고 0128이 시험을 고친 뒤 develop CI는 통과했다. 흔들림이 아니라 지우지 않았다.
- 이 티켓이 더한 브라우저 시험의 부하 반복 결과는 PR 본문에 적는다.

### 범위 밖으로 확인한 것

- **쿠키 없는 첫 방문 hydration 불일치(0126에서 넘어옴).** 개발 서버에서만 난다. 브라우저 시간대가 Asia/Seoul이고 `tz` 쿠키가 없으면 `/`·`/runs`·`/stats` 첫 방문에서 "Hydration failed"가 난다(America/New_York·UTC에서는 나지 않음, Dashboard "Done today" 개수와 Stats 막대 제목이 서버 UTC 값과 달라짐). 루트 `TimeZoneSync`가 쿠키를 쓰고 루트를 다시 읽는 것(약 200ms)이 개발 서버에서 아직 hydration되지 않은 화면 경계보다 먼저 와서 그 경계를 클라이언트에서 다시 그린다. 경로 코드 묶음을 기다리기, `requestIdleCallback`, `load` 이벤트를 기다리기로는 없어지지 않았고 3초 늦추면 없어졌다. 같은 코드의 프로덕션 빌드에서는 세 시간대·여섯 화면을 두 번 돌려 한 번도 나지 않았다. 그래서 고치지 않았다.
- **레일 200% 겹침(0126에서 넘어옴).** 200% 확대(640×450)에서 레일 아래쪽을 덮던 둥근 그림은 개발 빌드에만 있는 TanStack Query devtools 단추다. 레일 자체는 `AppFrame`의 `railBody`가 세로로 스크롤되고 잘린 항목이 아래에 걸쳐 보여 더 있음을 알린다. 제품 화면 문제는 아니다.

### 시험

- `apps/web/src/run-detail/actions.test.ts`: 성공한 쓰기는 런을 보이는 key만 무효화하고 셸과 다른 런의 상세는 그대로(라우터 다시 읽기 시험과 "아직 옮기지 않은 화면 고르기"는 지웠다).
- `apps/web/src/shell/screen-error.test.ts`: `_app` 아래 화면 route가 모두 공용 오류 화면을 쓰고, 셸 자신과 셸 밖 route는 루트 오류 화면에 맡긴다.
- `e2e/src/query-cache.test.ts`(0123의 오류 시험 둘을 새 동작으로 바꾸고 셋을 더함): 서버 렌더·hydration 뒤 레일이 남고 화면 칸에만 오류, 화면으로 옮기다 실패해도 레일이 남고 머리로 포커스, 다시 읽기는 실패한 화면만 다시 읽고(루트·셸 0번) 성공하면 레일의 지금 화면 링크로 포커스, 또 실패하면 실패 문장으로 포커스, 다른 화면에 갔다 오면 지난 실패 문장이 남지 않음.
- `e2e/src/query-screens.test.ts`: 변경 기록이 끊기면 열린 Tickets·Runs·Stats가 30초마다 자기 query를 다시 읽고 루트는 읽지 않는다(가짜 시계). 스펙 7절 4번이 빠져 있던 화면이다.
- 그대로 통과: `navigation.test.ts`(0117), `runs-query`, `dashboard-query`, `query-screens`, `settings-query`, `change-events`, `run-detail`, `home`.

## 머지 위험

저장 형식은 바꾸지 않아 two-way다. 닿는 곳은 web 전체다.
