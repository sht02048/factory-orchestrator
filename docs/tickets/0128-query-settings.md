---
status: done
blocked_by: [0127]
---

# 0128 Settings를 Query로

## 목표

Settings를 Query로 옮긴다. 저장 뒤에 Settings 전체와 트래커 세 읽기를 다시 하지 않고, 바꾼 key만 무효화하거나 새 값으로 바꾼다. 스펙 [0003](../spec/0003-query-cache.md) 4.3~4.5절, 운영자 결정 C3·C5·C7.

## 배경

- 저장이 성공하면 `useReloadOnSuccess`가 `router.invalidate()`를 불러 Settings 전체를 다시 읽는다. 트래커 프로젝트·상태·라벨 읽기(약 0.7초)도 다시 돈다(research [0016](../research/0016-web-data-loading.md) 5절).
- 0115의 직렬 저장(`settings/serial-save.ts`)과 초안 맞추기(`settings/synced-save.ts`)는 지킨다(C7).
- 0122와 같은 로더 파일(`packages/app/src/settings/load.ts`)을 고친다. 0122가 먼저 머지됐으면 그 서버 캐시 위에서 나누고, 함께 돌면 늦게 머지하는 쪽이 맞춘다.
- 0119가 Settings를 세 route(`/settings`, `/settings/mcp`, 트래커 프로젝트 상세 `settings_.projects.$connectionId.$projectId`)로 나눴다. 셋 다 같은 `getSettingsPage`를 통째로 부른다. 아래 key 모양은 이 세 화면에 맞춰 이 티켓이 정한다.
- 저장 뒤 할 일을 부르는 쪽이 넘기게 하는 훅 나누기는 0127이 했다. 온보딩은 라우터 로더로 남아(C1) 계속 `router.invalidate()`를 쓴다.
- Settings 저장은 셸의 Workspace 목록을 바꿀 수 있어 0127의 셸 query 뒤에 한다(C14).

## 할 일

1. **query 나누기.** DB 설정은 `["settings", ...]`(staleTime 30초), 트래커 프로젝트·상태는 `["tracker", "projects" | "states", ...]`(staleTime 5분, C3). 라벨은 0127이 만든 `["tracker", "labels", connectionId, projectId]`를 그대로 쓴다. 서버 함수도 그에 맞춰 나눈다. `["tracker", ...]` key는 트래커 응답 원본만 담고, 트래커 프로젝트 고르기에 덧붙이는 DB 값(다른 Workspace의 주인, Mapping, Queued 런 수, `packages/app/src/settings/load.ts:348-395`)은 `["settings", ...]` 쪽에서 계산한다(스펙 4.3). 온보딩은 `loadSettingsPage`를 그대로 부르므로(`apps/web/src/onboarding/load.ts:54`) 그 모양을 지키거나 온보딩 쪽을 함께 고친다. MCP 도구(`apps/cli/src/mcp/server.ts`)가 부르는 Settings 로더의 출력 모양도 지킨다.
2. **저장 뒤(C7).** Settings 세 route가 0127의 훅에 넘기는 `router.invalidate()`를 바꾼 key 무효화나, 서버가 새 값을 돌려주면 `setQueryData`로 바꾼다. 직렬 저장·초안 맞추기의 동작(마지막 값만 모아 차례로, 실패하면 되돌림, 저장된 값으로 다시 맞춤)은 그대로다.
3. **쓰기 오류(C5).** 쓰기 서버 함수는 지금처럼 `{ ok: false, reason }`을 돌려주고, mutation이 이유가 담긴 오류로 바꾼다. 화면 문구는 그대로다.
4. **트래커.** "Linear에서 다시 읽기"는 `["tracker"]`만 무효화한다. 라벨 만들기는 Auto-assign Label을 DB에도 저장하므로(`packages/app/src/settings/actions.ts`의 `createAutoAssignLabel`이 `saveAutoAssignLabel`을 부른다) `["tracker"]`와 `["settings"]`를 무효화한다. 트래커 연결과 트래커 프로젝트 더하기·지우기도 `["tracker"]`를 함께 무효화한다. 다른 탭·기기에도 닿도록 0124의 `tracker` 변경 기록을 쓴다.
5. **변경 기록.** Settings 쓰기가 0124에서 `workspace`·`settings`·`tracker` 줄을 스펙 5.2대로 남기는지 0119 뒤 쓰는 곳 모두에 대해 확인한다. 빠진 곳은 이 티켓에서 더한다.
6. 셸과 함께 바뀌는 저장(Workspace 이름, 더하기)은 `["shell"]`도 무효화한다.
7. 세 route에 `preloadStaleTime` 0을 주고 `router.invalidate()`를 지운다. 트래커 프로젝트 상세에서 프로젝트를 지운 뒤의 필터 무효화(`/_app/settings`)도 key 무효화로 바꾼다.

## 완료 조건

- [x] 시험: 서버 렌더한 화면에서 hydration이 끝날 때까지 이 화면의 서버 함수를 다시 부르지 않는다.
- [x] 시험: mutation 하나 뒤 다시 읽는 서버 함수가 그 mutation이 바꾼 query뿐이다. 루트(`getTimeZone`, `getTitleBarHidden`)와 셸(`getShell`)은 다시 읽지 않는다(스펙 7절 2번의 예외 제외).
- [x] 시험: Mapping을 저장해도 트래커 프로젝트·상태·라벨을 다시 읽지 않는다(트래커 가짜 어댑터 호출 수).
- [x] 시험: 온보딩은 저장 뒤 지금처럼 다시 읽는다.
- [x] 0115의 직렬 저장·초안 맞추기 시험(`serial-save.test.ts`, `mapping-draft.test.ts`)이 그대로 통과한다.
- [x] 시험: 다른 탭에서 설정을 저장하면 열린 Settings가 3초 안에 바뀐다.
- [x] 시험: SSE가 끊기면 열린 Settings가 30초마다 다시 읽는다(가짜 시계).
- [x] 0117 브라우저 시험이 같은 뜻으로 통과한다(스펙 7절 5번).

## 확인 결과(2026-11-20)

### 만든 것

- **로더 나누기(`packages/app/src/settings/`).** `loadSettingsDb`(DB 설정: Workspace, 묶인 프로젝트와 Mapping, Auto-assign Label, 모든 Workspace의 트래커 프로젝트 주인·Mapping 수·Queued 런 수, 설치 설정), `loadTrackerProjectLists`(연결마다 트래커 프로젝트 목록 원본), `loadBoundProjectReads`(그 Workspace에 묶인 프로젝트마다 상태·라벨 원본). 합치기 `mergeSettingsPage`·`connectionProjectsOf`는 `merge.ts`의 순수 함수로 서버와 브라우저가 함께 쓴다. `loadSettingsPage`(MCP 도구·온보딩)와 `loadTrackerProjectChoices`(온보딩)는 이 셋을 합쳐 출력 모양이 그대로다(시험: 합친 결과가 한 번에 읽은 Settings와 같다, `ws` 넷).
- **서버 함수.** `getSettingsPage`를 `getSettings`, `getTrackerProjects`, `getBoundProjectReads`로 나눴다.
- **query(`apps/web/src/settings/settings-query.ts`).** `["settings", ws]`(30초), `["tracker", "projects"]`(5분), `["tracker", "states", ws]`(5분, 상태와 라벨). 읽지 못한 트래커가 있으면 Tickets처럼 30초. 상태 query가 받은 라벨을 0127의 `["tracker", "labels", connectionId, projectId]`에 채우고, 화면은 그 key의 값을 읽는다(Tickets가 더 새로 읽었으면 그 값). 이번 읽기가 실패했으면 실패를 보인다. 연결 상세의 Tailscale 안내는 `["webhook-setup"]`.
- **route.** 네 route(`/settings`, `/settings/mcp`, 트래커 프로젝트 상세, 트래커 연결 상세)에 `preloadStaleTime: 0`, DB는 `loadRouteQuery`, 트래커는 `loadCachedRouteQuery`. 연결 상세는 0130 뒤 생긴 넷째 route라 함께 옮겼다. `router.invalidate()`를 모두 지웠다.
- **저장 뒤(C7).** `useSettingsActions(afterChange)`의 저장마다 `useMutation`이고, `mutationFn`이 `{ ok: false, reason }`을 `MutationRejectedError`로 바꿔 throw한 뒤 화면에는 지금처럼 `{ ok: false, reason }`을 돌려준다(C5, 문구 그대로). 성공하면 그 저장이 남기는 변경 기록 종류(`settings`, `workspace`, `runner`, `tracker`)를 넘기고, Settings route는 변경 기록 구독과 같은 표(`INVALIDATED_KEYS`)로 그 key만 무효화한다. Workspace 이름은 `workspace`라 `["shell"]`도, 트래커 연결·프로젝트 더하기·빼기·라벨 만들기·webhook 끄기는 `["tracker"]`도 무효화한다. "Linear에서 다시 읽기"는 `["tracker"]`만. 온보딩은 같은 key 무효화 뒤 지금처럼 `router.invalidate({ sync: true })`(C1).
- **0131의 '저장했어요 순간 옛 값이 보이지 않음'.** 무효화 promise는 다시 읽기가 끝나면 풀리지만 Query는 관찰자에게 `setTimeout(0)` 뒤에 알린다. 그래서 저장 뒤 동작은 다시 읽기를 기다린 뒤 Query의 알림 차례(`notifyManager.schedule`)까지 기다린다. 시험: MCP 쓰기 허용 스위치는 "저장했어요"가 뜰 때 이미 새 값이다. 0131의 e2e도 그대로 통과한다.
- **0131 MEDIUM(`useSyncedSave`가 저장 뒤 서버 값으로 다시 맞추지 않음).** 저장하는 동안 바뀐 저장된 값을 기억했다가 저장이 끝나면(성공) 초안을 그 값으로 맞춘다(`createSavedResync`, 시험 넷). 실패는 지금처럼 되돌린다.
- **0130의 webhook 기다림 3초 폴링.** 지웠다(`useWebhookWaitPolling`, `pollWebhookState`, `getTrackerWebhookState`, `webhookReceiptKey`). 수신 기록이 남기는 `settings` 변경 기록이 `["settings"]`를 무효화한다. 변경 기록이 끊기면 30초 폴링이 대신한다. 시험: webhook을 처음 받으면 열린 연결 상세가 3초 안에 받는 중으로 바뀌고, 그사이 부른 서버 함수는 `getSettings` 하나다.
- **프로젝트 빼기.** 트래커 프로젝트 상세에서 빼면 저장 뒤 동작이 `["settings"]`·`["tracker"]`를 다시 읽는다. 그동안 화면이 "이 Workspace에 없는 트래커 프로젝트예요."로 바뀌지 않게, route가 빼기를 시작할 때의 화면을 붙잡아 두고 Settings로 옮긴다. 라우터 필터 무효화는 지웠다. 시험: 찾을 수 없음 화면 없이 돌아오고 목록에서 빠진다.

### 찾은 것

- **Mapping 저장이 `tracker` 변경 기록을 남겼다.** 0122가 Mapping 저장 때 서버 캐시 세대를 올리려고 `markTrackerChanged`를 불렀고, 0124 뒤 그 함수가 `tracker` 줄도 써서 변경 기록 통로가 켜진 운영에서는 Mapping 저장 1초 뒤 모든 탭이 트래커 query를 다시 읽었다. Mapping은 트래커를 바꾸지 않으므로 0127의 할당처럼 `markTrackerReadsStale`(세대만 올림)로 바꿨다. 시험: 통로를 켠 채 Mapping을 저장해도 트래커 함수와 가짜 어댑터 호출이 없다(`markTrackerChanged`로 되돌리면 실패하는 것을 확인), Mapping 저장이 남기는 변경 기록이 `settings` 하나.
- **변경 기록(할 일 5).** 0119 뒤 Settings 쓰기(`packages/app/src/settings/actions.ts`)가 부르는 `packages/db` 쓰기 함수를 모두 대 보았다. Workspace(`saveWorkspace` → `workspace`), 트래커 프로젝트 더하기·빼기(`settings`·`tracker`), Mapping(`replaceMapping` → `settings`), In Progress 상태·Auto-assign Label·GitHub 토큰·주소·확인한 webhook 주소·MCP 쓰기 허용(`settings`), 트래커 연결 저장·webhook 끄기(`settings`·`tracker`), 잠자기(`recordSettingsChange`), 러너 저장·점검 요청(`runner`), 라벨 만들기(`saveAutoAssignLabel` + `markTrackerChanged`). 빠진 곳은 없었다(0124의 `change-events.test.ts`가 함수마다 시험한다).
- **Settings 화면 이동 왕복.** 첫 방문은 서버 함수 셋(`getSettings`, `getTrackerProjects`, `getBoundProjectReads`)을 함께 불러 왕복은 한 번만큼 든다. MCP와 연결 상세는 트래커를 읽지 않는다.

### 시험

- `e2e/src/settings-query.test.ts`(브라우저, 변경 기록 통로를 막은 채가 기본): 서버 렌더한 네 화면은 hydration 동안 서버 함수 0번, Mapping 저장 뒤 `saveWorkspaceMapping`·`getSettings`만 부르고 트래커 가짜 어댑터 호출 수가 그대로, 통로를 켜도 Mapping 저장 뒤 트래커를 다시 읽지 않음, In Progress 상태 저장 뒤 `getSettings`만, MCP 쓰기 허용 저장 뒤 `getSettings`만(루트·셸 없음)이고 "저장했어요" 때 이미 새 값, Workspace 이름 저장 뒤 `getSettings`·`getShell`만, "Linear에서 다시 읽기" 뒤 트래커 함수 둘만, 다른 탭의 저장이 3초 안에, webhook 첫 수신이 3초 안에, 끊기면 30초마다(가짜 시계), 프로젝트 빼기.
- 온보딩 저장 뒤 다시 읽기는 `e2e/src/onboarding.test.ts`·`runner-setup.test.ts`가 그대로 통과하는 것으로 확인한다. `settings.test.ts`(0115·0119·0130·0131), `query-screens.test.ts`, `navigation.test.ts`(0117), `runners.test.ts`, `change-events.test.ts`도 통과한다.
- `apps/web/src/settings/load-split.test.ts`(DB 부분은 트래커를 읽지 않음, 합친 결과가 같음, 주인·Mapping 수는 DB 부분, Mapping 저장 뒤 DB만 다시 읽어도 맞음, Mapping 저장의 변경 기록, 라벨, 아직 읽지 않은 트래커, 온보딩 고르기), `synced-save.test.ts`, `settings-query.test.ts`. `serial-save.test.ts`·`mapping-draft.test.ts`는 그대로 통과한다.

## 머지 위험

저장 형식은 바꾸지 않아 two-way다. 닿는 곳은 web(Settings)과 `packages/app`의 Settings 로더다.
