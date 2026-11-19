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

## 할 일

1. **셸.** `["shell"]`(`getShell`). `_app` 로더가 이 query를 데운다. 구독 모듈이 `runner`·`workspace`·`settings` 바뀜에 무효화한다. 셸 query는 이 티켓이 만들고 0128이 Settings 저장 뒤 무효화에 쓴다.
2. **Runners.** `["runners", "list"]`(`getRunnersPage`). `reloadOnEnter`를 지운다. 러너 다시 점검 요청은 mutation으로 바꾸고, 점검 3초 폴링(`useRunnerCheckPolling`, 최대 2분)은 `refetchInterval`로 옮긴다. 점검이 끝나면 `["runners", "list"]`와 `["shell"]`만 무효화한다.
3. **Tickets 나누기.** 서버 함수를 둘로 나눈다.
   - DB 부분(런 표시, 할당할 수 있음 등): `["tickets", "runs", ws]`, staleTime 30초.
   - 트래커 티켓 목록과 라벨: `["tracker", "tickets", ws]`, staleTime 5분(C3). 라벨 key는 0128의 Settings 라벨 query와 같은 key를 쓰도록 맞춘다.
   - 화면은 두 결과를 합쳐 그린다. 트래커가 느리면 지금처럼 `Remote<T>`로 그 부분만 기다리거나 실패를 보인다.
4. **할당.** 성공하면 `["tickets", "runs"]`와 런 쪽 key만 무효화한다. 트래커 query는 건드리지 않는다.
5. **트래커 무효화(C3).** `tracker` 바뀜(webhook, "Linear에서 다시 읽기", 라벨 만들기)에 `["tracker"]`를 무효화한다.
6. 세 route에 `preloadStaleTime` 0을 주고 `router.invalidate()`를 지운다. `_app`의 `shouldReload: false`는 셸 query로 옮긴 뒤 의미가 없으면 지운다.

## 완료 조건

- [ ] 시험: 서버 렌더한 화면에서 hydration이 끝날 때까지 이 화면의 서버 함수를 다시 부르지 않는다.
- [ ] 시험: mutation 하나 뒤 다시 읽는 서버 함수가 그 mutation이 바꾼 query뿐이다. 루트(`getTimeZone`, `getTitleBarHidden`)와 셸(`getShell`)은 다시 읽지 않는다.
- [ ] 시험: 할당 뒤 트래커 티켓 목록을 다시 읽지 않는다(트래커 가짜 어댑터 호출 수).
- [ ] 시험: 러너가 Offline이 되면 셸 배지와 Runners가 3초 안에 바뀐다.
- [ ] 시험: Workspace를 더하면 셸의 Workspace 목록이 바뀐다.
- [ ] 시험: 트래커 webhook을 받으면 Tickets의 트래커 query가 다시 읽힌다.
- [ ] 시험: 미리 읽은 뒤 Runners에 들어가면 서버 함수를 더 부르지 않는다.
- [ ] 시험: SSE가 끊기면 열린 Runners가 30초마다 다시 읽는다(가짜 시계).
- [ ] 로더 SQL 수 시험(`apps/web/src/server/loader-queries.test.ts`)에 Tickets DB 부분을 더했다.
- [ ] 0117 브라우저 시험이 그대로 통과한다(포인터를 올린 뒤 Tickets를 누르면 느린 트래커를 기다리지 않는다).

## 머지 위험

저장 형식은 바꾸지 않아 two-way다. 닿는 곳은 web(셸, Runners, Tickets)과 `packages/app`의 Tickets 로더다.
