---
status: todo
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
3. **함께 쓰는 훅 나누기.** `settings/use-settings-actions.ts`의 `useSettingsActions`·`useReloadOnSuccess`는 Settings 세 route, Runners, 온보딩이 함께 쓴다(research 0016 3·4절). 저장·점검이 끝난 뒤 할 일을 부르는 쪽이 넘기게 바꾼다. Runners는 위 key 무효화를 넘기고, Settings와 온보딩은 지금처럼 `router.invalidate()`를 넘긴다(Settings는 0128이 바꾸고, 온보딩은 라우터 로더로 남는다, C1). `useSettingsActions`의 `pollRunnerChecks`는 온보딩만 쓰므로(`onboarding/onboarding-screen.tsx:126`) `router.invalidate()`로 남는다. Runners의 점검 요청·점검 끝은 훅이 아니라 `routes/_app/runners.tsx:49-58`의 `recheck`·`pollChecks`에서 바꾼다. `useRunnerCheckPolling`은 이미 `poll`을 인자로 받아 나눌 필요가 없다. 셸이 Query가 되므로 Settings가 넘기는 저장 뒤 동작에는 `["shell"]` 무효화를 함께 넣어, 0128 전에도 Workspace 이름 바꾸기가 셸에 바로 닿게 한다(스펙 6절 3번). Runners 안의 러너 설정에서 key 무효화를 쓰는 것은 C1의 해석이라(스펙 2절) 시작할 때 운영자에게 확인한다. Runners 화면에서 러너를 더하거나 저장하는 동작(`saveRunner` 등)도 이 티켓이 맡는다. Runners와 온보딩이 함께 쓰는 `runner-setup/use-runner-setup-actions.ts`(This Mac 설정, 러너 등록 끝)도 같은 방식으로 나눈다. Runners는 `["runners", "list"]`와 `["shell"]` 무효화를 넘기고 온보딩은 `router.invalidate()`를 넘긴다.
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

## 머지 위험

저장 형식은 바꾸지 않아 two-way다. 닿는 곳은 web(셸, Runners, Tickets)과 `packages/app`의 Tickets 로더다.
