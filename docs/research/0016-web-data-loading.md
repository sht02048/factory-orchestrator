# 웹 화면의 데이터 읽기와 캐시 지도

조사일 2026-11-19. `develop`(0118·0119 머지 뒤, `1e287f6`)의 웹 앱이 데이터를 어디서 읽고 어디에 담아 두며 언제 다시 읽는지, 그래서 어디서 낡은 값을 보이고 어디서 같은 것을 두 번 읽는지 정리한다. 제품 코드는 바꾸지 않았다. TanStack Query 조사는 research [0015](0015-tanstack-query.md), 이 지도를 바탕으로 정한 것은 ADR [0019](../adr/0019-query-cache-and-change-events.md)와 스펙 [0003](../spec/0003-query-cache.md)에 있다.

출처 표시는 research 0014를 따른다.

- **[코드]** 이 저장소의 파일. `경로:줄`을 단다. 줄은 위 커밋 기준이다.
- **[측정]** 티켓 [0117](../tickets/0117-navigation-performance.md)이 잰 값.
- **[추정]** 코드로 확인하지 않은 판단. 그렇다고 적는다.

0120(러너 쪽 멈춤 감지)은 아직 `develop`에 없어 반영하지 않았다.

## 요약

- 클라이언트 캐시는 라우터의 로더 캐시 하나다. 모든 화면은 route `loader`가 서버 함수를 불러 채운다 **[코드]**.
- 쓰기 뒤에는 거의 모두 필터 없는 `router.invalidate()`를 부른다. 그러면 루트(시간대, 제목 표시줄)·셸·지금 화면 로더가 모두 다시 돈다 **[코드]**.
- 서버가 바뀐 것을 웹으로 밀어 주는 길이 없다. Dashboard만 15초마다 다시 읽고, 다른 화면은 머무는 동안 다시 읽지 않는다 **[코드]**.
- 알림 사건 SSE가 있지만 구독자는 데스크톱 앱의 main 프로세스뿐이고, 런 시작·상태 전이·할당·설정 변경은 싣지 않는다 **[코드]**.
- 트래커(Linear)를 기다리는 화면은 Tickets와 Settings 둘이다. 쓰기 하나마다 이 트래커 읽기가 다시 돈다 **[코드]**.

## 1. 라우터 캐시

- `apps/web/src/router.tsx:4-12`: `defaultPreload: "intent"`, `defaultPreloadStaleTime: PRELOAD_FRESH_MS`(5초). 그 밖은 라우터 기본값이다(`defaultStaleTime` 0, `defaultGcTime` 5분, `defaultPendingMs` 1초, pending 컴포넌트 없음) **[코드]**.
- 루트 `apps/web/src/routes/__root.tsx:39-43`: 로더가 `getTimeZone`·`getTitleBarHidden`을 읽고 `shouldReload: false`. 셸 `apps/web/src/routes/_app.tsx:16-17`: 로더가 `getShell`을 읽고 `shouldReload: false` **[코드]**.
- 루트 `beforeLoad`(`__root.tsx:29, 32-38`)는 브라우저에서 온보딩 완료를 한 번 확인하면(`completeInBrowser`) 다시 묻지 않는다. 그래서 첫 클라이언트 이동 한 번은 `getOnboardingComplete` 왕복을 더 한다 **[코드]**.
- Runners(`apps/web/src/routes/_app/runners.tsx:27-29, 37`)는 `shouldReload: reloadOnEnter`로 들어올 때만 다시 읽는다. 포인터를 올려 미리 읽은 뒤 5초 안에 들어와도 `cause`가 `"enter"`라 한 번 더 읽는다 **[추정]**(라우터 소스의 `shouldReload` 함수와 preload 신선도의 우선순위를 시험으로 확인하지 않았다).
- 설치된 `@tanstack/router-core` 1.171.39에서는 `match.invalid`가 `shouldReload: false`보다 앞선다. 필터 없는 `router.invalidate()`는 루트·셸·지금 화면을 모두 다시 읽고, 캐시에 남은 다른 화면은 invalid로 표시한다 **[코드]**(`node_modules`의 router-core `load-client`).

## 2. 화면별 로더

숫자는 0117이 잰 "고친 뒤" 값이다(ms, 첫 방문 바로 누름 / 다시 들어가기 / 300ms 올려 둔 뒤 누름, 같은 기기) **[측정]**. 원격 왕복 지연은 빠져 있다.

| 화면      | 로더(route)                   | 서버 함수(`apps/web/src/server/…`)                         | 읽는 것                                                                                                                                                                             | 숫자       |
| --------- | ----------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 루트      | `__root.tsx:39-42`            | `functions.ts:23` `getTimeZone`, `:27` `getTitleBarHidden` | 시간대·제목 표시줄 쿠키                                                                                                                                                             | —          |
| 셸        | `_app.tsx:16`                 | `functions.ts:31` `getShell`                               | Workspace 목록, 러너(Runner Issue 배지)                                                                                                                                             | —          |
| Dashboard | `_app/index.tsx:23-24`        | `functions.ts:37-41` `getHomePage`                         | 런과 기록, 러너 자리, 대기 사유, Question·Permission. 시간대 쿠키                                                                                                                   | 95/60/67   |
| Tickets   | `_app/tickets.tsx:22-23`      | `functions.ts:97-105` `getTicketsPage`                     | DB + 트래커 티켓 목록(250개씩 최대 4쪽을 차례로) + 라벨. 끝난 런마다 기록을 따로 읽는다                                                                                             | 587/69/244 |
| Runs      | `_app/runs.tsx:22-28`         | `functions.ts:51-67` `getRunsPage`                         | 조건에 맞는 런, 끝난 런 개수, 대기 사유. 시간대 쿠키(`:65`)                                                                                                                         | 101/55/79  |
| Run 상세  | `_app/runs_.$runId.tsx:27`    | `functions.ts:81-83` `getRunDetail`                        | 런·기록·Question·Permission·취소와 멈추기 요청·상태 변경·MCP 작업 기록·로그 요청·같은 티켓의 런                                                                                     | —          |
| Runners   | `_app/runners.tsx:36`         | `functions.ts:33-35` `getRunnersPage`                      | 러너와 런                                                                                                                                                                           | 99/67/45   |
| Stats     | `_app/stats.tsx:23-25`        | `functions.ts:69-79` `getStatsPage`                        | 끝난 런 집계. 시간대 쿠키                                                                                                                                                           | 100/66/43  |
| Settings  | `_app/settings.tsx:19-20`     | `settings-functions.ts:57` `getSettingsPage`               | DB 설정 여럿 + 트래커 프로젝트 목록·상태·라벨(한꺼번에). 0119가 더한 `settings_.mcp.tsx:17-18`, `settings_.projects.$connectionId.$projectId.tsx:20-21`도 같은 로더를 통째로 부른다 | 782/67/232 |
| 온보딩    | `routes/onboarding.tsx:27-29` | `onboarding-functions.ts:21-23` `getOnboardingPage`        | 온보딩 단계. Settings 로더를 그대로 불러(`apps/web/src/onboarding/load.ts:54`) 트래커도 읽는다                                                                                      | —          |

- Tickets 트래커 읽기: `packages/app/src/tickets/load.ts:48-49`(`PAGE_SIZE` 250, `MAX_PAGES` 4), `:192-208`(쪽을 차례로 읽음), `:122-124`(라벨), `:263`(끝난 런마다 `getRunWithRecords`) **[코드]**.
- Settings 트래커 읽기: `packages/app/src/settings/load.ts:309`(세 묶음을 한꺼번에), `:353-359`(프로젝트 목록) **[코드]**.
- 서버 함수는 43개다. `functions.ts` 15, `settings-functions.ts` 18, `onboarding-functions.ts` 3, `runner-setup-functions.ts` 7 **[코드]**.

## 3. 쓰기 뒤 다시 읽기

`router.invalidate()`를 부르는 곳은 8개 파일에 18곳이고(Run 상세의 `reload` 정의 포함), 필터가 있는 것은 둘이다 **[코드]**.

| 곳                                                               | 언제                                                                                                                                                                                              | 필터                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `routes/__root.tsx:113-118`                                      | 브라우저 시간대를 처음 쿠키에 쓸 때                                                                                                                                                               | 루트·`/_app/stats`·`/_app/`. Runs가 빠짐 |
| `routes/_app/index.tsx:71, 75, 79`                               | Dashboard 답하기·거절·멈추기와 재개                                                                                                                                                               | 없음                                     |
| `routes/_app/runners.tsx:52, 57`                                 | 러너 다시 점검 요청, 점검이 끝났을 때                                                                                                                                                             | 없음                                     |
| `routes/_app/runs_.$runId.tsx:46`(`reload`), `:52, 61, 68`       | Run 상세 답하기·거절·취소·멈추기와 재개·로그 다시 받기, 열 때 로그 요청, 로그·멈추기 요청 폴링                                                                                                    | 없음                                     |
| `routes/_app/tickets.tsx:66`                                     | 할당 뒤                                                                                                                                                                                           | 없음                                     |
| `settings/use-settings-actions.ts:33, 53, 56, 68`                | Settings 쓰기(`then`으로 감싼 13가지), 라벨 만들기, 트래커 다시 읽기 버튼, 러너 점검 끝. 이 훅은 Settings 세 route와 Runners(`runners.tsx:63`), 온보딩(`routes/onboarding.tsx:63-64`)이 함께 쓴다 | 없음                                     |
| `routes/_app/settings_.projects.$connectionId.$projectId.tsx:67` | 트래커 프로젝트를 지운 뒤                                                                                                                                                                         | `/_app/settings`                         |
| `runner-setup/use-runner-setup-actions.ts:21, 30`                | This Mac 설정 단계 끝, 러너 등록 끝                                                                                                                                                               | 없음                                     |

쓰기 오류 표현은 섞여 있다 **[코드]**.

- 대부분 결과 유니온을 돌려준다(`ActionResult`, `assignTicket`, `cancelRun`, `controlRun`, `setUpWorkspace`).
- `answerQuestion`·`denyPermission`은 실패하면 throw한다.
- Run 상세는 `cancelRun`의 `{ ok: false }`를 `expectOk`(`runs_.$runId.tsx:19-21`)로 throw로 바꾼다.
- 로더가 throw하면 루트의 `RootError`(`__root.tsx:80-92`)가 화면 전체를 대신한다. route별 `errorComponent`는 없다.
- 로더 안의 트래커 실패는 throw하지 않고 `Remote<T>` 데이터로 화면 안에 보인다.

## 4. 폴링

| 곳                                                                                                                                              | 주기                                                                     | 결과가 가는 곳                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------- |
| Dashboard `home/refresh.ts:3, 11-38`, `_app/index.tsx:44-50`                                                                                    | 15초, 탭이 보일 때만                                                     | 라우터 캐시 밖 로컬 state(`index.tsx:35-36`). 셸은 그대로 |
| Dashboard 멈추기·재개 처리 중 `_app/index.tsx:14, 51-56`                                                                                        | 2초                                                                      | 위와 같은 로컬 state                                      |
| Run 상세 로그 `runs_.$runId.tsx:23-24, 56-64`                                                                                                   | 2초 × 최대 15번                                                          | `router.invalidate()`                                     |
| Run 상세 멈추기·재개 처리 중 `runs_.$runId.tsx:66-70`                                                                                           | 2초                                                                      | `router.invalidate()`                                     |
| 러너 점검 `settings/settings-screen.tsx:114-146`(Runners `runners/runners-screen.tsx:432`와 온보딩 `onboarding/onboarding-screen.tsx:126`이 씀) | 점검 요청 뒤 3초, 최대 2분(`packages/app/src/settings/model.ts:159-160`) | 끝나면 `router.invalidate()`                              |
| This Mac 상태 `runner-setup/runner-setup.tsx:56`                                                                                                | 2.5초                                                                    | 컴포넌트 state                                            |
| 러너 등록 `runner-setup/enrollment.tsx:37`                                                                                                      | 2초                                                                      | 끝나면 `router.invalidate()`                              |

그 밖에는(Tickets, Runs, Stats, Settings, 셸, 점검 요청이 없을 때의 Runners) 머무는 동안 다시 읽지 않는다 **[코드]**.

## 5. Settings 저장(0115)

`settings/serial-save.ts`는 마지막 값만 모아 차례로 보내고 실패하면 되돌린다. `settings/synced-save.ts`는 화면의 초안을 두고 저장된 값(`savedKey`)으로 다시 맞춘다. Mapping 편집기와 Auto-assign Label 고르기가 쓴다 **[코드]**. 저장이 성공하면 `useReloadOnSuccess`(`use-settings-actions.ts:28-38`)가 `router.invalidate()`를 불러 Settings 전체를 다시 읽는다. 트래커 세 읽기(약 0.7초)도 다시 돈다 **[코드]**, **[측정]**.

## 6. 알림 사건 SSE

- `/api/notification-events/stream`(`routes/api/notification-events/stream.ts:12-25`, `notifications/stream.ts`): 연결마다 2초(`STREAM_POLL_MS`, `stream.ts:3`)마다 `syncNotifications`를 부르고 바뀐 사건을 보낸다. 사건 id는 번호(`seq`)이고, `ready`(`stream.ts:55`)와 15초 하트비트, `retry: 3000`이 있다. `Last-Event-ID`나 `?after=`로 이어 받는다(`stream.ts:87-91`) **[코드]**.
- `syncNotifications`는 Dashboard 로더(`loadHomePage`, 모든 Workspace)를 다시 계산해 원인을 찾는다(`packages/app/src/notifications/causes.ts:86-88`). 서버 전체에서 1초에 한 번으로 묶는다(`notifications/notifications.ts:12, 18-30`) **[코드]**.
- 종류는 8가지다(`packages/db/src/notification-events-model.ts:1-10`): question, permission, human-check, failed, disconnected, runner-offline, runner-auth, runner-usage-limit. 런 시작, Queued·Running 사이 옮김, Paused, 할당, PR·CI 바뀜, 설정 저장은 없다 **[코드]**.
- 구독자는 데스크톱 앱 main 프로세스뿐이다(`apps/desktop/src/core/notification-feed.ts`, OS 알림과 Dock 배지). 웹 화면에는 구독 코드가 없다 **[코드]**.

## 7. 프로세스와 DB

- `ganger start`가 web과 worker를 자식 프로세스로 띄운다(`apps/cli/src/start.ts:101-102`). `ganger mcp`도 같은 DB 파일을 연다(`apps/cli/src/mcp/open.ts:27-31`). 세 프로세스가 SQLite 파일 하나를 WAL 모드(`packages/db/src/database.ts:16`)로 직접 읽고 쓴다 **[코드]**.
- web이 DB에 쓴 직후 worker를 깨우는 길은 IPC다(`apps/web/src/server/worker-wake.ts`, 티켓 0058). 반대 방향(worker·MCP가 쓴 것을 web에 알리기)은 없다 **[코드]**.

## 8. 낡은 값을 보이는 곳

1. 셸의 Runner Issue 배지와 Workspace 목록: 다른 쓰기나 새로고침이 있기 전까지(몇 시간도) 그대로다.
2. Tickets·Runs·Run 상세·Runners·Stats·Settings에 머무는 동안: 끝없이 그대로다. 로그·멈추기 처리 중 폴링만 예외다.
3. Dashboard: 최대 15초. 미리 읽은 화면: 최대 5초. 다시 들어간 화면: 왕복 한 번 동안.
4. 시간대를 처음 정할 때 Runs는 다시 읽지 않는다(`__root.tsx:113-118` 필터에 `/_app/runs`가 빠짐). Runs의 기간 조건이 서버 시간대로 계산된 채 남는다.
5. 데스크톱 OS 알림은 약 2초 안에 오지만, 같은 앱의 웹 창은 그 바뀜을 모른다.
6. worker(런 상태, 러너 점검)·트래커 webhook·MCP 쓰기·다른 기기의 쓰기를 열린 화면으로 밀어 넣는 길이 없다.

## 9. 같은 것을 두 번 읽는 곳

- 쓰기 하나마다 서버 함수가 최소 4번 돈다(루트 2, 셸 1, 화면 1). 화면이 Settings·Tickets면 트래커도 다시 읽는다.
- Dashboard 15초 폴링 결과는 라우터 캐시 밖에 있어, 다른 화면에 갔다 오면 로더가 다시 읽는다.
- Runners는 미리 읽은 뒤 들어가면 또 읽을 수 있다(1절, **[추정]**).
- 할당 뒤 트래커 티켓 목록 전체를 다시 읽는다(`tickets.tsx:66`). 바뀐 것은 런 표시뿐이다.
- Mapping 자동 저장마다 Settings 전체와 트래커 세 읽기가 다시 돈다.
- Run 상세를 열면 실행 중인 런일 때(`requested`가 참일 때) `getRunDetail` → `requestRunLog` → `router.invalidate()` → `getRunDetail`로 한 번 더 읽는다(`runs_.$runId.tsx:50-54`).
- Tickets와 Settings가 같은 트래커 라벨을 따로 읽는다.

## 10. 지켜야 할 계약

- 0117 브라우저 시험(`e2e/src/navigation.test.ts:108, 122, 133`): 포인터를 올린 뒤 누르면 느린 트래커를 기다리지 않는다. 한 번 본 화면은 다시 들어갈 때 지난 내용을 바로 그리고 뒤에서 새로 읽는다. 다시 들어간 화면은 그사이 바뀐 런 상태를 보인다.
- 재는 도구: `e2e/src/measure-navigation.ts`, `e2e/src/navigation-timing.ts`.
- 로더 SQL 수 시험: `apps/web/src/server/loader-queries.test.ts`.
