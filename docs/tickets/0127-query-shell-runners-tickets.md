---
status: doing
blocked_by: [0124]
---

# 0127 셸·Runners·Tickets를 Query로

## 목표

셸(레일 배지, Workspace 목록), Runners, Tickets를 Query로 옮긴다. Tickets는 DB 부분과 트래커 부분을 나눠, 할당 뒤에 트래커를 다시 읽지 않는다. 스펙 [0003](../spec/0003-query-cache.md) 4.3~4.5절, 운영자 결정 C1·C3·C4·C6·C12.

## 배경

- 셸은 `shouldReload: false`라 다른 쓰기나 새로고침 전까지 배지와 Workspace 목록이 그대로다(research [0016](../research/0016-web-data-loading.md) 8절 1번).
- Runners는 `reloadOnEnter`로 들어올 때마다 다시 읽어, 미리 읽은 뒤에도 한 번 더 읽을 수 있다.
- Tickets 로더는 DB와 트래커 티켓(250개씩 최대 4쪽을 차례로)·라벨을 한 번에 읽고, 할당 뒤 `router.invalidate()`로 트래커까지 다시 읽는다(research 0016 2·9절).
- 0122가 트래커 결과를 서버에 담아 두는 일을 따로 한다. 이 티켓은 브라우저 쪽 query만 다룬다.

- 0122와 같은 로더 파일(`packages/app/src/tickets/load.ts`)을 고친다. 0122가 먼저 머지됐으면 그 서버 캐시 위에서 나누고, 함께 돌면 늦게 머지하는 쪽이 맞춘다.

## 할 일

1. **셸.** `["shell"]`(`getShell`). `_app` 로더가 이 query를 데운다. 구독 모듈이 `runner`·`workspace` 바뀜에 무효화한다(스펙 5.4). 셸 query는 이 티켓이 만들고 0128이 Settings 저장 뒤 무효화에 쓴다.
2. **Runners.** `["runners", "list"]`(`getRunnersPage`). `reloadOnEnter`를 지운다. 러너 다시 점검 요청은 mutation으로 바꾸고(0124의 오류 타입), 점검 3초 폴링(최대 2분)은 가벼운 `getRunnerChecksPending`을 읽는 작은 query(`["runners", "checks-pending"]`)의 `refetchInterval`로 옮긴다. Runners 전체를 3초마다 읽지 않는다. 점검이 끝나면 `["runners", "list"]`와 `["shell"]`만 무효화한다.
3. **함께 쓰는 훅 나누기.** `settings/use-settings-actions.ts`의 `useSettingsActions`·`useReloadOnSuccess`는 Settings 세 route, Runners, 온보딩이 함께 쓴다(research 0016 3·4절). 저장·점검이 끝난 뒤 할 일을 부르는 쪽이 넘기게 바꾼다. Runners는 위 key 무효화를 넘기고, Settings와 온보딩은 지금처럼 `router.invalidate()`를 넘긴다(Settings는 0128이 바꾸고, 온보딩은 라우터 로더로 남는다, C1). `useSettingsActions`의 `pollRunnerChecks`는 온보딩만 쓰므로(`onboarding/onboarding-screen.tsx:126`) `router.invalidate()`로 남는다. Runners의 점검 요청·점검 끝은 훅이 아니라 `routes/_app/runners.tsx:49-58`의 `recheck`·`pollChecks`에서 바꾼다. `useRunnerCheckPolling`은 이미 `poll`을 인자로 받아 나눌 필요가 없다. 셸이 Query가 되므로 Settings가 넘기는 저장 뒤 동작에는 `["shell"]` 무효화를 함께 넣어, 0128 전에도 Workspace 이름 바꾸기가 셸에 바로 닿게 한다(스펙 6절 3번). Settings의 필터 없는 `router.invalidate()`는 0128까지 남으므로 스펙 7절 2번 시험은 옮긴 화면의 쓰기에만 건다. Settings에서 러너를 저장한 뒤 Runners·Tickets 같은 옮긴 화면은 변경 기록과 다시 들어갈 때의 새로 읽기가 맞춘다. Runners 안의 러너 설정에서 key 무효화를 쓰는 것은 C1의 해석이라(스펙 2절) 시작할 때 운영자에게 확인한다. Runners 화면에서 러너를 더하거나 저장하는 동작(`saveRunner` 등)도 이 티켓이 맡는다. Runners와 온보딩이 함께 쓰는 `runner-setup/use-runner-setup-actions.ts`(This Mac 설정, 러너 등록 끝)도 같은 방식으로 나눈다. Runners는 `["runners", "list"]`와 `["shell"]` 무효화를 넘기고 온보딩은 `router.invalidate()`를 넘긴다.
4. **Tickets 나누기.** 서버 함수를 둘로 나눈다.
   - 할당할 수 있음과 할당 기본값(`assignabilityOf`·`assignDefaultsOf`, `packages/app/src/tickets/load.ts:271-337`)과 라벨의 자동 할당 표시(`:165-168`)는 트래커 라벨과 DB(Mapping, Auto-assign Label)를 함께 쓴다. 그래서 DB 부분은 티켓별 런, Mapping과 저장소, 러너, Auto-assign Label id만 돌려주고, 클라이언트가 트래커 티켓·라벨과 합쳐 계산한다. 두 함수는 서버와 클라이언트가 함께 쓰는 순수 함수로 두고, MCP의 `loadTicketsPage`는 같은 합치기를 서버에서 한다.
   - DB 부분(런 표시와 위 DB 값): `["tickets", "runs", ws]`, staleTime 30초.
   - 트래커 티켓 목록: `["tracker", "tickets", ws]`, staleTime 5분(C3).
   - 트래커 라벨: `["tracker", "labels", connectionId, projectId]`, staleTime 5분. 이 티켓이 만들고 0128의 Settings가 그대로 쓴다. 프로젝트마다 서버 함수를 따로 부르면 원격 왕복이 는다. 트래커 티켓 함수가 라벨을 함께 돌려주고 클라이언트가 `setQueryData`로 프로젝트별 key를 채우는 방식을 먼저 보고, 화면 이동 한 번의 왕복 수를 시험으로 센다.
   - 트래커 query를 다시 들어갈 때도 뒤에서 새로 읽을지는 이 티켓을 시작할 때 운영자와 정한다(스펙 0003 열린 질문 2).
   - MCP 도구(`apps/cli/src/mcp/server.ts`, `write-tools.ts`)도 `loadTicketsPage`를 부른다. 나눈 뒤에도 그 출력 모양을 지킨다.
   - 화면은 두 결과를 합쳐 그린다. 트래커가 느리면 지금처럼 `Remote<T>`로 그 부분만 기다리거나 실패를 보인다.
5. **할당.** 성공하면 `["tickets", "runs"]`와 런 쪽 key만 무효화한다. 트래커 query는 건드리지 않는다.
6. **트래커 무효화(C3).** `tracker` 바뀜(webhook, "Linear에서 다시 읽기", 라벨 만들기)에 `["tracker"]`를 무효화한다.
7. 세 route에 `preloadStaleTime` 0을 주고 `router.invalidate()`를 지운다. 아직 옮기지 않은 화면도 바꾸는 쓰기는 옮기는 동안 그 route id만 고른 `router.invalidate({ filter })`를 함께 부른다(스펙 6절 3번). `_app`의 `shouldReload: false`는 이 티켓이 셸 query로 옮기며 정리한다(루트는 그대로 둔다, C1). 지우더라도 `_app` 로더는 `["shell"]`을 데우기만 하고 화면 이동마다 뒤에서 다시 읽지 않는다. 셸은 변경 기록과 셸을 바꾸는 쓰기로만 새로 읽는다.

## 완료 조건

- [ ] 시험: 서버 렌더한 화면에서 hydration이 끝날 때까지 이 화면의 서버 함수를 다시 부르지 않는다.
- [ ] 시험: mutation 하나 뒤 다시 읽는 서버 함수가 그 mutation이 바꾼 query뿐이다. 루트(`getTimeZone`, `getTitleBarHidden`)와 셸(`getShell`)은 다시 읽지 않는다(스펙 7절 2번의 예외 제외).
- [ ] 시험: 할당 뒤 트래커 티켓 목록을 다시 읽지 않는다(트래커 가짜 어댑터 호출 수).
- [ ] 시험: 러너가 Offline이 되면 셸 배지와 Runners가 3초 안에 바뀐다.
- [ ] 시험: Workspace를 더하면 셸의 Workspace 목록이 바뀐다.
- [ ] 시험: 트래커 webhook을 받으면 Tickets의 트래커 query가 다시 읽히고, 0122의 서버 캐시가 있어도 새 트래커 값을 보인다.
- [ ] 시험: 미리 읽은 뒤 Runners에 들어가면 서버 함수를 더 부르지 않는다.
- [ ] 시험: 훅을 나눈 뒤에도 온보딩과 Settings는 저장·점검 뒤 지금처럼 다시 읽는다.
- [ ] 시험: SSE가 끊기면 열린 Runners가 30초마다 다시 읽는다(가짜 시계).
- [ ] 로더 SQL 수 시험(`apps/web/src/server/loader-queries.test.ts`)에 Tickets DB 부분을 더했다.
- [ ] 0117 브라우저 시험이 같은 뜻으로 통과한다(포인터를 올린 뒤 Tickets를 누르면 느린 트래커를 기다리지 않는다). 시험이 기다리는 `getTicketsPage` 이름만 트래커를 읽는 새 서버 함수로 바꾼다(스펙 7절 5번).

## 확인 결과(2026-11-20)

### 시작할 때 정한 것

- **C1 해석(스펙 2절).** Runners 안의 러너 설정(`RunnerForm`의 러너 저장, This Mac 설정, 러너 등록 끝)은 `["runners", "list"]`와 `["shell"]` 무효화를 쓰고, 온보딩 안에서는 `router.invalidate()`를 쓴다. 코디네이터가 운영자 해석대로 승인했다.
- **트래커 query를 다시 들어갈 때(스펙 열린 질문 2).** 운영자 결정 A: 다시 들어가도 5분을 지킨다. 다시 들어갈 때 뒤에서 새로 읽는 것은 DB 부분뿐이다. `navigation.test.ts`의 다시 들어가기 시험은 `getTicketRuns`를 기다린다. webhook이 없는 설치의 한계는 스펙 열린 질문 2에 적었다.

### 만든 것

- **Tickets 나누기(`packages/app/src/tickets/`).** `loadTicketRuns`(DB 부분: 티켓별 런과 할당 막힘·다시 쓸 저장소, Mapping·저장소 이름, 러너, Auto-assign Label id)와 `loadTrackerTickets`(트래커 티켓과 프로젝트별 라벨 `Remote<{id, name}>`). 할당할 수 있음·할당 기본값(`assignabilityOf`·`assignDefaultsOf`)과 합치기(`mergeTicketsPage`)는 `merge.ts`의 순수 함수로 서버(MCP의 `loadTicketsPage`)와 브라우저가 함께 쓴다. MCP 출력 모양은 그대로다(시험: 합친 결과가 `loadTicketsPage`와 같다). DB 부분은 끝난 런마다 `getRunWithRecords`를 부르던 것을 `listRunsWithRecords` 한 번으로 바꿔 런 수와 상관없는 SQL 수로 읽는다.
- **서버 함수.** `getTicketsPage`를 `getTicketRuns`와 `getTrackerTickets`로 나눴다.
- **query.** `apps/web/src/shell/shell-query.ts`(`["shell"]`, `useShell`), `runners/runners-query.ts`(`["runners", "list"]`, `["runners", "checks-pending"]` staleTime 0), `tickets/tickets-query.ts`(`["tickets", "runs", ws]` 30초, `["tracker", "tickets", ws]` 5분). 트래커 티켓 query의 `queryFn`이 받은 라벨을 `["tracker", "labels", connectionId, projectId]`에 `setQueryData`로 채운다. 그래서 Tickets 화면 이동 한 번은 서버 함수 둘(`getTicketRuns`, `getTrackerTickets`)이고 라벨을 따로 읽지 않는다(브라우저 시험).
- **셸.** `_app` 로더는 `queryClient.query({ ...shellQuery, staleTime: "static" })`로 데우기만 하고 `shouldReload: false`를 지웠다. 미리 읽기와 이동마다 로더가 돌아도 캐시만 돌려줘 `getShell`을 부르지 않는다. 셸은 `useShell()`로 그린다. 로더가 셸 값을 그대로 돌려주므로 아직 `useLoaderData({ from: "/_app" })`를 읽는 Runs·Stats·Settings는 바뀌지 않는다(이동할 때 그 값도 캐시를 따라간다).
- **Runners.** `preloadStaleTime: 0`, `loadRouteQuery`, `reloadOnEnter` 지움. 다시 점검은 mutation(`okOrThrow`)이고 성공하면 `["runners", "list"]`만 무효화한다. 점검 끝 확인은 `["runners", "checks-pending"]`를 읽고(`runnerChecksStillPending`) 끝났으면 `["runners", "list"]`와 `["shell"]`만 무효화한다. 3초 간격과 2분 한도는 온보딩과 함께 쓰는 `useRunnerCheckPolling`이 그대로 정한다(티켓 할 일 3이 이 훅은 나누지 않는다고 적어서, `refetchInterval` 대신 이 훅의 타이머가 그 작은 query를 3초마다 읽는다. Runners 전체는 3초마다 읽지 않는다).
- **Tickets.** `preloadStaleTime: 0`. 로더는 DB 부분을 `loadRouteQuery`로, 트래커 부분을 새 공용 도구 `loadCachedRouteQuery`(다시 들어가면 캐시를 쓰고 뒤에서 읽지 않으며, 미리 읽기는 query의 staleTime을 본다)로 함께 기다린다. 화면은 두 결과를 `mergeTicketsPage`로 합쳐 그린다. 할당은 mutation이고 성공하면 변경 기록 `assignment`와 같은 key(`["tickets", "runs"]`와 런 쪽 key)만 무효화한다. "Linear에서 다시 읽기"는 서버 함수 뒤 `["tracker"]`를 무효화한다. `router.invalidate()`를 지웠다.
- **함께 쓰는 훅.** `useSettingsActions(afterSave)`, `useReloadOnSuccess(afterSave)`, `useRunnerSetupActions(afterRunnerAdded)`가 저장 뒤 동작을 받는다. Runners는 `refreshRunnersAndShell`, 온보딩은 `useRouterReload()`(`router.invalidate()`), Settings 세 route는 `useSettingsReload()`(`["shell"]` 무효화 뒤 `router.invalidate()`)를 넘긴다. 라벨 만들기와 Settings의 "Linear에서 다시 읽기"는 `router.invalidate()`에 더해 `["tracker"]`를 무효화한다. `pollRunnerChecks`(온보딩만 씀)는 `router.invalidate()` 그대로다.
- **공용 파일에 더한 것(작게).** `query/route-query.ts`에 `loadCachedRouteQuery`, `query/mutation-error.ts`에 `rejectionReasonOf`(목록의 이유만 꺼냄)를 더했다. 기존 함수는 바꾸지 않았다. 할당 거절 이유 목록 `ASSIGN_REJECT_REASONS`는 클라이언트가 읽을 수 있게 `tickets/model.ts`에 두었다(`assign.ts`는 `@ganger/db`를 불러 클라이언트 묶음에 넣을 수 없다).

### 찾은 것

- **`signal`을 서버 함수에 넘기면 다시 들어갈 때의 뒤 읽기가 끊긴다.** 처음에는 0123의 예대로 `queryFn: ({ signal }) => getTicketRuns({ data, signal })`로 썼다. 그러자 `navigation.test.ts`의 다시 들어가기 시험이 60초 넘게 멈췄다. 로더가 시작한 뒤 읽기가 브라우저에서 취소(request failed)됐다. query-core는 `signal`을 읽은 요청을 관찰자가 모두 빠지면 취소하고, 개발 빌드의 StrictMode 이중 마운트가 다시 들어간 화면의 관찰자를 한 번 뗐다 붙인다(0125가 같은 것을 찾아 코디네이터가 알려 줌). 그래서 이 티켓의 query는 `signal`을 넘기지 않는다. 시험: 변경 기록 통로를 막은 채 다시 들어간 Runners·Tickets가 그사이 바뀐 러너 상태·생긴 런을 그린다. `signal`을 되돌리면 이 두 시험이 실패하는 것을 확인했다.
- **0123 독립 리뷰 MEDIUM(gcTime 5분이 라우터 match 캐시보다 짧음).** 이 화면들에서는 재현되지 않았다. Runners·Tickets를 열고 다른 화면으로 옮긴 뒤 가짜 시계로 6분을 보내 query가 지워진 것(돌아올 때 Tickets가 트래커 함수를 다시 읽음)을 확인하고 돌아와도, 빈 대체 화면 없이 앞 화면을 둔 채 읽기를 기다렸다가 그린다. 라우터 이동이 transition이라 React가 앞 화면을 남긴다. 다만 5분이 지나면 다시 들어가기도 첫 방문처럼 읽기를 기다린다(라우터 캐시만 쓰던 지난 동작은 30분까지 바로 그렸다). 공용 기본값은 바꾸지 않았다. 시험: `query-screens.test.ts`의 "5분 넘게 떠났다 돌아와도" 둘.

### 시험

- `e2e/src/query-screens.test.ts`(브라우저): hydration 동안 서버 함수 0번(Tickets, Runners), 할당 뒤 `assignTicket`·`getTicketRuns`만 부르고 트래커 가짜 어댑터 호출 수가 그대로, Tickets 이동 한 번의 서버 함수 둘, 다시 점검 뒤 `getRunnersPage`만·점검 끝에 `getRunnersPage`·`getShell`만(루트 없음), Offline이 3초 안에 셸 배지와 Runners에, Workspace 더하기가 셸 목록에, webhook 뒤 0122 서버 캐시가 있어도 새 트래커 값, 미리 읽은 뒤 Runners 진입에 서버 함수 0번, Settings 저장 뒤 `getSettingsPage`·`getShell`을 다시 읽고 셸에 새 이름, 끊기면 Runners 30초마다(가짜 시계), 5분 넘게 떠났다 돌아와도 빈 대체 화면 없음(Runners, Tickets), 통로를 막은 채 다시 들어간 Runners·Tickets가 바뀐 상태를 그림. mutation 시험은 변경 기록 통로를 막고 돈다(스펙 7절 2번).
- 온보딩 저장·러너 등록 뒤 다시 읽기는 `e2e/src/onboarding.test.ts`·`runner-setup.test.ts`가 그대로 통과하는 것으로 확인한다(단계가 넘어가려면 다시 읽어야 한다).
- `apps/web/src/tickets/load.test.ts`: DB 부분은 트래커를 읽지 않음, 합친 결과가 `loadTicketsPage`와 같음, 라벨을 프로젝트마다 돌려줌, 런이 바뀌면 트래커를 다시 읽지 않고 할당할 수 있음을 다시 계산함. `loader-queries.test.ts`에 Tickets DB 부분. `route-query.test.ts`에 `loadCachedRouteQuery` 둘, `mutation-error.test.ts`에 `rejectionReasonOf` 둘.
- `navigation.test.ts`: 미리 읽기 시험은 `getTrackerTickets`, 다시 들어가기 시험은 `getTicketRuns`를 기다린다(운영자 결정 A). 그 밖의 기대는 그대로다.

### 측정(0117 시험 계약과 `--rtt`)

`MEASURE_RTT=0,100,200 MEASURE_TRACKER_DELAY=500 pnpm exec vitest run -c e2e/vitest.measure.config.ts`, 개발 서버, 트래커 읽기마다 500ms, 3번 중앙값(ms). 전은 `develop` 99b58b8, 후는 이 브랜치다. 화면 이동 시간(누름 → 그림)과 그 사이 부른 서버 함수다.

| 왕복 | 경우                      | Tickets 시간 | Tickets 서버 함수(전 → 후)                             | Runners 시간 | Runners 서버 함수(전 → 후)    |
| ---: | ------------------------- | -----------: | ------------------------------------------------------ | -----------: | ----------------------------- |
|    0 | 첫 방문, 바로 누름        |     100 → 96 | `getTicketsPage` → `getTicketRuns`·`getTrackerTickets` |    102 → 103 | `getRunnersPage` 그대로       |
|    0 | 다시 들어가기             |      68 → 68 | `getTicketsPage` → `getTicketRuns`                     |      83 → 83 | `getRunnersPage` 그대로       |
|    0 | 첫 방문, 300ms 올려 둔 뒤 |      78 → 79 | 없음                                                   |      64 → 80 | `getRunnersPage` 1ms → 없음   |
|  100 | 첫 방문, 바로 누름        |    397 → 418 | 위와 같음(둘을 함께 부름, 각 108ms)                    |    512 → 520 | 그대로                        |
|  100 | 다시 들어가기             |      84 → 78 | `getTicketsPage` → `getTicketRuns`                     |      85 → 84 | 그대로                        |
|  100 | 첫 방문, 300ms 올려 둔 뒤 |    115 → 115 | 없음                                                   |    245 → 230 | `getRunnersPage` 165ms → 없음 |
|  200 | 첫 방문, 바로 누름        |    701 → 719 | 위와 같음(각 209ms)                                    |    919 → 933 | 그대로                        |
|  200 | 다시 들어가기             |      66 → 73 | `getTicketsPage` → `getTicketRuns`                     |      66 → 68 | 그대로                        |
|  200 | 첫 방문, 300ms 올려 둔 뒤 |    415 → 425 | 없음                                                   |    848 → 833 | `getRunnersPage` 353ms → 없음 |

- 이동 시간은 측정 흔들림 안에서 같다. 이 티켓은 이동을 빠르게 하는 일이 아니라 다시 읽는 범위를 좁히는 일이라 예상대로다.
- Runners는 `reloadOnEnter`를 지워, 포인터를 올려 미리 읽은 뒤 누를 때 `getRunnersPage`를 한 번 더 부르지 않는다.
- Tickets 다시 들어가기의 뒤 읽기가 트래커를 함께 읽던 `getTicketsPage`에서 DB만 읽는 `getTicketRuns`로 바뀌었다(운영자 결정 A).
- 첫 방문의 Tickets는 서버 함수 둘을 함께 부른다. 왕복은 겹쳐 한 번만큼 든다(100 → 108ms씩, 200 → 209ms씩).

## 머지 위험

저장 형식은 바꾸지 않아 two-way다. 닿는 곳은 web(셸, Runners, Tickets)과 `packages/app`의 Tickets 로더다.
