---
status: done
blocked_by: [0123]
---

# 0124 change_events 표와 SSE 통로

## 목표

DB에서 바뀐 것을 열린 웹 화면이 몇 초 안에 알게 한다. 바꾸는 코드가 `change_events`에 줄을 남기고, web이 새 SSE 통로로 보내며, 브라우저가 그 대상의 query key만 무효화한다. 스펙 [0003](../spec/0003-query-cache.md) 5절, ADR [0019](../adr/0019-query-cache-and-change-events.md), 운영자 결정 C4·C9~C12.

## 배경

- worker·트래커 webhook·MCP·다른 기기가 바꾼 것을 웹으로 밀어 넣는 길이 없다(research [0016](../research/0016-web-data-loading.md) 8절).
- 알림 사건 SSE(`/api/notification-events/stream`)는 알릴 일만 싣고 데스크톱 앱이 쓴다. 건드리지 않는다(C10).
- web, worker, `ganger mcp` 세 프로세스가 SQLite 파일 하나를 연다. 그래서 바뀜은 메모리가 아니라 DB 표로 넘긴다(C9).

## 할 일

1. **표.** `packages/db`에 `change_events`(`seq` 단조 증가, `kind`, `target_id`, `workspace_id`, `at`)와 마이그레이션을 더한다. `kind`는 `run`, `runner`, `assignment`, `workspace`, `settings`, `tracker`다(C12). `at`에 지우기용 색인을 둔다.
2. **쓰는 곳(같은 트랜잭션, 바뀐 것이 있을 때만).** worker가 주기마다 부르는 쓰기 함수(`recordRunQuestions`, `recordPermissionWaits`, `resolvePermissionWaits`, `recordRunnerCheck`, `recordProviderUsage`, 같은 값을 다시 쓰는 `updateRunRecords`)는 화면에 보이는 값을 쓰기 전과 뒤로 견줘 그대로면 줄을 쓰지 않는다. `checkedAt`·`readAt`만 바뀐 것은 바뀜이 아니다(스펙 5.2). `packages/db`의 쓰기 함수 안에서 줄을 써서 web·worker·MCP 어느 프로세스가 불러도 빠지지 않게 한다. 스펙 5.2의 표를 따른다.
   - run: 상태 바뀜과 Paused, PR·CI 바뀜, Question·Permission 생김과 답·거절, 취소·멈추기·재개·로그 요청과 처리 결과, 티켓 제목 채움. 0120이 더한 쓰는 곳도 찾는다.
   - runner: 점검 결과와 Online/Offline, 공급자 사용량, 러너 저장·capacity, Mailbox Terminal(`setRunnerMailbox`).
   - assignment: 새 런(자동, 수동, MCP).
   - workspace: Workspace 더하기·이름(지우기가 생기면 지우기).
   - settings: 그 밖의 Settings 쓰기 모두(0119 뒤 모양), Mapping, Auto-assign Label, In Progress 상태, 트래커 연결, 설치 전체 설정, MCP 쓰기 허용.
   - tracker: 트래커 webhook을 받음, "Linear에서 다시 읽기", 라벨 만들기, 트래커 연결이나 Workspace의 트래커 프로젝트가 바뀜. 한 쓰기가 둘 이상에 해당하면 줄을 둘 이상 쓴다(스펙 5.2).
   - "Linear에서 다시 읽기"는 지금 클라이언트의 `router.invalidate()`뿐이다. `tracker` 줄을 쓰는 서버 동작을 더한다(0122가 서버 캐시를 비우는 동작을 먼저 만들었으면 거기에 붙인다). 이 줄과 라벨 만들기의 `tracker` 줄은 트래커 API 호출 뒤에 쓰며, DB 트랜잭션에 묶이지 않는다.
   - web의 변경 기록 읽기가 `tracker` 줄을 보면 브라우저에 보내기 전에 0122의 그 연결 서버 캐시를 비운다(스펙 5.2). 0122가 아직 없으면 0122가 이 연결을 만든다.
   - worker가 트래커를 바꾸는 일(`apps/worker/src/after-run.ts`의 `markInProgress`, 댓글)도 `tracker` 줄을 쓴다. 지금 `markInProgress`는 범용 `updateRunRecords({ trackerStateSetAt })`만 부르므로, 줄을 쓰는 곳(전용 db 함수인지 부르는 곳인지)을 정해 적는다.
   - 표에 없는 쓰기 함수(`setQueuedRunRunner`, `recordStartRequested`, `recordStartFailure`, `saveCodeHostConnection`, `recordMcpAction`, 점검 요청 `requestRunnerCheckSetting`, Run 상세가 보이는 트래커 프로젝트 이름을 바꾸는 Settings 쓰기)도 하나씩 본다. 잠자기 설정은 DB 밖이라 저장 뒤 `settings` 줄을 따로 쓴다.
   - MCP 프로세스(`ganger mcp`)의 쓰기도 같은 함수를 지나 줄을 남기는지 시험으로 확인한다.
3. **통로 `/api/change-events/stream`.** `apps/web/src/routes/api/`에 둔다. web 프로세스 하나가 1초마다 마지막 번호 뒤의 줄을 읽어 열린 연결 모두에 보낸다. 메시지는 `change`(`id`=`seq`, `{ kind, targetId, workspaceId }`), `ready`, `reset`, 15초 하트비트, `retry`. `Last-Event-ID`(또는 `?after=`)로 이어 받고, 이어 받을 수 없으면 `reset`을 보낸다(C11, 스펙 5.3). 받은 번호가 지운 번호의 상한(정리 때 반드시 따로 남긴다. 정리도 번호로 한다, 스펙 5.3)보다 작을 때와, 지금 가장 큰 번호보다 클 때(DB 파일을 되돌림)다. 표가 비어 있어도 판단할 수 있어야 한다. 요청 검사(Host·Origin)는 다른 웹 경로와 같다.
4. **지우기.** 하루 지난 줄을 지운다(C9). 열린 연결 수와 상관없이 정한 주기로 돈다. 주기를 정해 적는다.
5. **웹 구독 모듈.** 이 티켓이 `_app` 셸에 마운트해 연결한다(아직 query가 없어도 해가 없다). 0125~0128은 자기 key가 무효화되는지만 확인한다. `change`를 스펙 5.4 표의 key 접두사 무효화로 바꾸고, 한 번에 온 줄은 모아 한 번 무효화한다. `reset`은 모든 query를 무효화한다. 첫 연결은 서버 렌더가 어떤 데이터보다 먼저(요청 시작이나 루트 `beforeLoad`, 로더가 아님) 읽어 넘긴 가장 큰 번호로 `?after=`를 주어 그사이 바뀜을 놓치지 않는다. 구독 모듈은 첫 연결 때 받은 번호만 쓴다(스펙 5.3). 아직 Query로 옮긴 화면이 없으므로, 구독 모듈과 대상→key 표는 시험으로 검증하고 화면 연결은 0125~0128이 한다.
6. **폴링 대비.** "끊김"을 알아보는 기준을 정한다(`EventSource`는 조용히 다시 붙는다. 예: `onerror` 뒤 `readyState`가 OPEN이 아님, 하트비트가 N초 넘게 없음). SSE가 끊기고 다시 붙지 않는 동안 30초마다 보이는 query를 다시 읽는다(C4). 다시 붙으면 멈춘다. 탭 복귀·재연결 다시 읽기(C6)는 Query 기본값으로 둔다.
7. **mutation 오류 타입.** 이유가 담긴 오류 타입과, 서버 함수의 `{ ok: false, reason }` 결과와 지금 throw하는 오류(`answerQuestion`·`denyPermission`)를 그 타입으로 바꾸는 함수를 `apps/web`에 둔다(C5, 스펙 4.4). 서버 함수는 바꾸지 않는다. 함께 도는 0125~0127이 이것을 쓴다. 서버 함수 경계를 넘은 오류에 `reason`(`AnswerRejectedError`·`DenyRejectedError`의 속성, `packages/app/src/home/actions.ts`)이 남는지 확인하고, 안 남으면 `message`에서 읽거나 이유 목록으로 맞춘다.
8. **탭 여러 개.** 탭 여러 개(HTTP/1.1)에서 연결 수 한도에 닿는지 재고 결과를 스펙 0003 열린 질문 1에 적는다. 닿으면 운영자와 정한다.
9. **같은 탭의 쓰기가 돌아옴.** 쓰기가 남긴 줄이 같은 탭에 돌아와 query를 한 번 더 읽는 횟수를 재고, 줄일 방법이 필요한지 스펙 0003 8절에 적는다.
10. **로그 요청의 무효화 범위.** 로그 요청과 그 결과가 `["runs", "detail", id]`만 무효화하도록 줄에서 가를지 재고 정한다. 런 시작마다 `tracker` 줄이 트래커를 다시 읽게 하는 비용도 함께 잰다(스펙 8절).

## 완료 조건

- [x] 시험: 2번의 쓰기 함수마다 같은 트랜잭션에서 `change_events` 줄이 생기고, 트랜잭션이 롤백되면 줄도 없다.
- [x] 시험: 바뀌는 것이 없는 호출(같은 Question을 다시 기록, 같은 점검 결과)은 줄을 남기지 않는다.
- [x] 시험: 표가 비어 있을 때 첫 연결의 번호(`max(가장 큰 seq, sqlite_sequence)`)로는 `reset`이 나지 않는다.
- [x] 시험: MCP 쓰기 도구로 바꾼 것도 줄을 남긴다.
- [x] 시험: 통로가 `Last-Event-ID` 뒤의 줄부터 보낸다. 지운 번호(표가 빈 경우 포함)와 지금보다 큰 번호면 `reset`을 보낸다. 하루 지난 줄을 지운다.
- [x] 시험: 오류 변환 함수가 `{ ok: false, reason }`과 throw한 오류를 같은 타입으로 바꾸고 이유를 지킨다.
- [x] 시험: 구독 모듈이 대상마다 스펙 5.4 표의 key만 무효화하고, `reset`에 모든 query를 무효화한다.
- [x] 시험: worker와 같은 함수로 런 상태를 바꾸면 열린 브라우저의 구독 모듈이 3초 안에 그 런의 key를 무효화한다.
- [x] 시험: SSE가 끊기면 30초마다 다시 읽고(가짜 시계), 다시 붙으면 멈춘다.
- [x] 0117 브라우저 시험이 같은 뜻으로 통과한다(스펙 7절 5번).
- [x] 되돌리는 방법을 이 티켓에 적었다(아래).

## 되돌리기

새 표를 더하는 마이그레이션이라 one-way다. 머지 전에 DB 파일을 복사해 두고, 되돌릴 때 이전 버전 앱과 그 파일로 돌아간다. 이전 버전 앱은 자기보다 앞선 스키마를 거부한다. web과 worker는 마이그레이션을 돌릴 때 모르는 마이그레이션이 있으면 `MigrationError`로 멈추고(`packages/db/src/migrate.ts:66-71`), `ganger mcp`는 `checkSchema`의 `ahead`로 거부한다(`apps/cli/src/mcp/open.ts`의 `schemaProblem`). 그래서 이전 버전으로는 백업한 DB 파일로만 돌아갈 수 있다.

확인(2026-11-20): `packages/db/src/change-events.test.ts`의 「되돌리기」 시험이 이 마이그레이션까지 적용한 DB에 이 마이그레이션을 뺀 목록(이전 버전)으로 `migrate`를 부르면 `MigrationError`("database has migrations this version does not know: …_change_events")로 멈추고, `checkSchema`는 `{ kind: "ahead" }`를 돌려줌을 확인한다. 그래서 되돌리는 순서는 다음과 같다.

1. 올리기 전: web·worker를 멈추고 DB 파일(`DATABASE_PATH`, WAL을 쓰므로 `-wal`·`-shm`도)을 복사한다.
2. 되돌릴 때: web·worker·`ganger mcp`를 멈추고, 이전 버전 앱을 설치하고, 복사한 DB 파일을 제자리에 돌려놓은 뒤 띄운다. 그사이 쓴 런·설정은 잃는다.
3. 표만 지우고 이전 버전을 쓰는 길(`DROP TABLE change_events`, `change_events_pruned`, `schema_migrations`에서 그 줄 지우기)은 이전 버전이 받아들이지만, 손으로 스키마를 고치는 일이라 권하지 않는다.

## 확인 결과(2026-11-20)

### 만든 것

- **표.** `packages/db/src/schema.ts`의 `change_events`(`seq` AUTOINCREMENT, `kind`, `target_id`, `workspace_id`, `part`, `at`, `at` 색인)와 지운 번호의 상한을 남기는 한 줄 표 `change_events_pruned`. 마이그레이션 `packages/db/drizzle/20261120004835_change_events`. `part`는 10번 결정(아래)의 로그 줄 표시다(`log`만 받는다).
- **기록 함수.** `packages/db/src/change-events.ts`: `recordChange`, `recordRunChange`(런의 Workspace를 읽어 싣는다), `recordRunnerChange`, `recordSettingsChange`, `markTrackerChanged`(0122의 세대 올리기와 `tracker` 줄을 한 트랜잭션에서), `latestChangeSeq`(`max(남은 가장 큰 seq, sqlite_sequence, 지운 상한)`), `changeResumeFrom`, `listChangesAfter`, `pruneChangeEvents`. `recordChange`의 타입은 `tracker`를 받지 않아, `tracker` 줄은 늘 `markTrackerChanged`로만 쓴다.
- **통로.** `apps/web/src/routes/api/change-events/stream.ts` → `apps/web/src/change-events/feed.ts`. web 프로세스의 `ChangeFeed` 하나가 연결이 하나라도 있으면 1초마다 마지막 번호 뒤를 읽어 모든 연결에 보낸다. 연결은 `retry: 3000`, 이어 받을 줄(`change`, `id`=`seq`), `ready`(`id`와 데이터가 지금 번호), 15초마다 `heartbeat` 사건을 받는다. 하트비트를 주석(`: ping`)이 아니라 사건으로 보내는 것은 브라우저 `EventSource`가 주석을 JS에 넘기지 않아 끊김을 알아볼 수 없어서다. Host·Origin 검사는 서버 입구(`apps/web/src/server.ts`의 `guardRequest`)가 모든 경로에 같이 한다.
- **구독 모듈.** `apps/web/src/change-events/channel.ts`(연결·모으기·끊김·폴링), `invalidation.ts`(스펙 5.4 표), `subscription.tsx`(`_app` 셸에 마운트). `queryClient.invalidateQueries`로 key 접두사를 무효화하므로 관찰자가 없는 query는 stale 표시만 된다.
- **mutation 오류.** `apps/web/src/query/mutation-error.ts`: `MutationRejectedError`(`reason`), `okOrThrow`(`{ ok: false, reason }` → throw), `toMutationError`·`rejectedAs`(throw한 오류 → 같은 타입), `ANSWER_REJECT_REASONS`·`DENY_REJECT_REASONS`.

### 쓰는 곳

스펙 5.2 표를 따르되, 화면에 보이는 값을 쓰기 전과 뒤로 견줘 바뀐 것이 없으면 쓰지 않는다. 모두 `packages/db` 함수 안에서 같은 트랜잭션으로 쓴다(바깥 트랜잭션이 있으면 savepoint).

| 대상                   | 함수                                                                                                                                                                                                   | 줄을 쓰는 때                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `run`                  | `changeRunState`, `fillRunTicketTitle`, `recordStartFailure`, `setQueuedRunRunner`, `updateRunRecords`                                                                                                 | 늘(상태) / 제목이 비어 있다가 채워질 때 / 실패 수·오류가 바뀔 때 / Queued 런의 러너가 바뀔 때 / 바꾼 열 가운데 `prCheckedAt` 밖의 값이 바뀔 때 |
| `run`                  | `recordRunQuestions`, `answerRunQuestion`, `markAnswerSent`, `recordPermissionWaits`, `resolvePermissionWaits`, `denyPermissionWait`, `markDenialSent`                                                 | 새로 넣거나 바꾼 줄이 있을 때                                                                                                                  |
| `run`                  | `requestRunCancel`, `markCancelRequestProcessed`, `requestRunControl`, `markRunControlOutcomeUnknown`, `completeRunControlRequest`                                                                     | 새 요청·처리 결과가 생길 때(이미 있는 요청을 다시 부르면 쓰지 않음)                                                                            |
| `run`(`part: log`)     | `requestLogTail`, `completeLogTailRequest`                                                                                                                                                             | 요청할 때와 결과가 생길 때                                                                                                                     |
| `run` + `settings`     | `recordMcpAction`                                                                                                                                                                                      | 런이 있으면 `run`, 늘 `settings`(`/settings/mcp`의 최근 작업)                                                                                  |
| `assignment`           | `assignRun`                                                                                                                                                                                            | 새 런(수동·자동·MCP 모두 이 함수)                                                                                                              |
| `runner`               | `recordRunnerCheck`                                                                                                                                                                                    | Online, `offlineSince`, 점검 오류, 할당 막힘, 전제 조건, 러너 프로젝트 가운데 하나라도 바뀔 때(`checkedAt`만 바뀌면 쓰지 않음)                 |
| `runner`               | `recordProviderUsage`                                                                                                                                                                                  | 처음 읽었거나 읽은 값이 바뀔 때(`readAt`만 바뀌면 쓰지 않음)                                                                                   |
| `runner`               | `saveRunner`, `saveRunnerCapacity`, `setRunnerMailbox`, `requestRunnerCheck`, `completeRunnerCheckRequest`                                                                                             | 저장 / capacity가 바뀔 때 / Mailbox가 바뀔 때 / 점검 요청(Runners의 "점검 중") / 점검 결과                                                     |
| `workspace`            | `saveWorkspace`                                                                                                                                                                                        | 새로 만들거나 이름·최대 실행 시간이 바뀔 때                                                                                                    |
| `settings`             | `saveCodeHostConnection`, `replaceMapping`(`saveMapping`도 지남), `saveAutoAssignLabel`, `saveMcpWriteAllowed`, `saveInstallAddresses`, `saveWorkspaceTrackerProject`(이름·In Progress 상태가 바뀔 때) | 저장할 때                                                                                                                                      |
| `settings` + `tracker` | `saveTrackerConnection`, `saveWorkspaceTrackerProject`(새 트래커 프로젝트), `removeWorkspaceTrackerProject`                                                                                            | 저장·더하기·지우기                                                                                                                             |
| `tracker`              | `recordTrackerEvent`(webhook), `markTrackerChanged`, `markAllTrackersChanged`("Linear에서 다시 읽기"의 `rereadTrackers`)                                                                               | 새 webhook 배달 / 부를 때                                                                                                                      |
| `settings`(DB 밖)      | `savePowerSetting`(`packages/app/src/settings/actions.ts`)                                                                                                                                             | 잠자기 설정 파일을 쓴 뒤 따로                                                                                                                  |

- **트래커 줄과 0122 서버 캐시.** 0122의 서버 캐시는 web 메모리가 아니라 DB 표 `tracker_read_generations`의 세대로 낡음을 안다. `markTrackerChanged`가 세대를 올리는 것과 `tracker` 줄을 같은 트랜잭션에서 쓰므로, web의 변경 기록 읽기가 `tracker` 줄을 보는 때에는 그 연결의 서버 캐시가 이미 쓰이지 않는다. 어느 프로세스가 썼든 같다. 그래서 읽기 쪽에서 따로 캐시를 비우는 코드를 두지 않았다.
- **같은 일을 두 번 쓰던 곳.** 트래커 연결 저장, 트래커 프로젝트 더하기·지우기, webhook 기록은 db 함수가 세대 올리기와 `tracker` 줄을 맡게 되어, 부르는 쪽(`packages/app/src/settings/actions.ts`, `apps/web/src/webhooks/receive.ts`)의 `markTrackerChanged`를 지웠다.
- **worker의 트래커 바꾸기.** `markInProgress`는 범용 `updateRunRecords({ trackerStateSetAt })`가 `run` 줄을, 같은 트랜잭션의 `markTrackerChanged`가 `tracker` 줄을 쓴다(부르는 곳에서 묶음). 결과 댓글(`commentResult`)도 같은 방식으로 `run`과 `tracker`를 쓴다. 전용 db 함수를 만들지 않은 것은 `trackerStateSetAt`·`trackerComment`가 `updateRunRecords`의 일반 열이고, 트래커 쪽 바뀜을 알리는 함수가 이미 `markTrackerChanged` 하나여서다.
- **Ganger 할당과 0122.** `packages/app/src/tickets/assign.ts`는 할당 뒤 0122대로 `markTrackerChanged`를 불러 `tracker` 줄도 남는다. 할당한 탭은 스펙 4.5대로 트래커 query를 무효화하지 않지만(0127), 열린 다른 Tickets 탭은 1초 뒤 트래커 query를 다시 읽는다. 0122가 할당 때 서버 캐시를 비우기로 한 이상 브라우저 캐시도 같이 낡았다고 보는 것이 맞다고 보고 그대로 두었다.
- **쓰지 않는 함수.** `recordStartRequested`·`clearStartRequested`(worker만 쓰는 시작 요청 시각, 화면에 없음), `markTrackerEventProcessed`(처리 결과는 할당 같은 다른 쓰기가 줄을 남김), `syncNotificationEvents`(알림 사건은 DB의 다른 바뀜에서 계산), `getInstallSettings`가 처음 만드는 설치 줄(화면 값이 바뀌지 않음).

### 정한 값

- **지우기 주기.** web 프로세스가 DB를 처음 열 때(`apps/web/src/server/database.ts`의 `getDatabase`) 한 번, 그 뒤 1시간마다 하루 지난 줄을 지운다. 열린 연결 수와 상관없다. 지울 때 `at`이 하루 지난 줄 가운데 가장 큰 `seq` 이하를 모두 지우고 그 번호를 `change_events_pruned`에 남긴다.
- **이어 받기.** `Last-Event-ID`가 있으면 그것을, 없으면 `?after=`를 쓴다. 둘 다 없으면 지금 번호부터 보낸다. 받은 번호가 지운 상한보다 작거나(`pruned`) 지금 번호보다 크면(`ahead`) `reset`을 보낸다. 지금 번호는 지운 상한과 `sqlite_sequence`를 함께 보므로 표가 비어도 처음 연결이 `reset`을 받지 않는다.
- **첫 연결 번호.** 루트 `beforeLoad`가 맨 앞에서 `createIsomorphicFn`으로 서버에서만 지금 번호를 읽고(클라이언트 이동 때는 `null`), 루트 로더가 그 값을 `changeSeq`로 loaderData에 싣는다. 클라이언트는 hydration 때 루트 `beforeLoad`를 다시 돌려 route context의 값이 `null`이 되고, `TimeZoneSync` 같은 루트 다시 읽기가 loaderData도 `null`로 덮는다. 그래서 루트 컴포넌트가 hydration 때 받은 값을 `RenderedChangeSeqProvider`의 state로 한 번 고정하고, 구독 모듈은 그 값만 쓴다. 브라우저 시험이 첫 연결의 `?after=`가 서버 렌더 때의 번호와 같음을 확인한다.
- **숨은 탭.** 위 8번 결정대로 숨은 탭은 연결하지 않는다. 숨은 동안은 30초 폴링도 하지 않고, 다시 보일 때 이어 받기와 Query의 창 포커스 다시 읽기가 메운다.
- **끊김 기준.** (1) `onerror` 뒤 `readyState`가 OPEN이 아님, 또는 (2) 어떤 사건(하트비트 포함)도 40초(`CHANGE_SILENCE_MS`, 하트비트 15초의 두 배 넘게) 없음. 끊기면 30초마다 `refetchQueries({ type: "active" })`로 보이는 query를 다시 읽고, 연결이 열리거나 사건을 받으면 멈춘다. 브라우저가 스스로 다시 붙지 않는 닫힘(CLOSED)과 조용함(2)은 5초 뒤 마지막으로 받은 번호로 직접 다시 연결한다.
- **모으기.** 받은 `change`는 100ms(`CHANGE_BATCH_MS`) 모아 key를 합치고, 더 짧은 접두사에 덮이는 key를 빼서 한 번 무효화한다. 서버가 1초 읽기 한 번에 읽은 줄을 이어서 보내므로 한 번 읽기의 줄은 한 묶음이 된다.
- **오류 변환과 서버 함수 경계.** 브라우저 시험으로 `answerQuestion`이 throw한 `AnswerRejectedError`를 받아 보니, 서버 함수 경계를 넘으면 `reason` 속성은 사라지고 `message`("answer rejected: not-found")만 남는다. 그래서 `toMutationError`는 `reason` 속성을 먼저 보고, 없으면 `message`의 `rejected: <이유>`를 이유 목록과 맞춰 읽는다. 목록에 없는 이유와 다른 오류(네트워크 등)는 그대로 둔다.

### 측정과 결정(8~10)

측정은 브라우저 시험과 같은 방식(vite 개발 서버, Chrome, HTTP/1.1)으로 시험 파일을 잠깐 만들어 돌렸고 커밋하지 않았다.

- **8. 탭 여러 개.** 한 브라우저에서 SSE를 연 탭이 5개일 때 6번째 탭은 147ms에 열렸다. 6개일 때 7번째 탭은 문서 요청부터 15초 넘게 열리지 않았다. HTTP/1.1에서 Chrome이 한 주소에 여는 연결 6개를 SSE가 모두 쥐어서다. 우리 web 서버(srvx)는 TLS 없이 HTTP/1.1로 뜨므로 같은 일이 난다(HTTP/2 프록시 뒤라면 한도가 없다, 재지 않음). 한도에 닿아 운영자에게 물었고, 숨은 탭은 연결을 닫기로 정했다(2026-11-20). 구독 모듈이 `visibilitychange`를 따라 `document.visibilityState`가 `hidden`이면 모아 둔 줄을 먼저 무효화한 뒤 연결과 타이머(끊김 폴링 포함)를 모두 거두고, 다시 보이면 마지막으로 받은 번호로 이어 받아 그사이 바뀜을 받는다. 브라우저 시험이 숨긴 탭 7개를 연 뒤 8번째 탭이 열리는지 확인한다. 남은 한도: 동시에 보이는 창이 6개를 넘고 HTTP/1.1일 때만 닿는다.
- **9. 같은 탭의 쓰기가 돌아옴.** 열린 화면에서 런 상태를 바꾸는 쓰기 하나마다 그 화면의 query를 한 번 더 읽었고, 첫 다시 읽기는 쓰기 뒤 0.5~1.1초에 왔다(세 번 재어 1140ms, 520ms, 468ms). 쓰기 하나에 보이는 query 하나를 한 번 더 읽는 정도라 지금은 줄이지 않는다. 0125~0127이 화면을 옮겨 mutation의 다시 읽기와 겹치는 횟수를 재고, 크면 "방금 다시 읽은 key는 건너뛰기"를 다시 본다(스펙 8절).
- **10. 로그 요청의 무효화 범위.** 실행 중인 런의 Run 상세를 열 때마다 로그 요청과 그 결과로 줄이 2개 생긴다. `run` 줄로 두면 열린 모든 탭의 Dashboard·Runs·Tickets·Runners·Stats·Settings를 두 번씩 무효화하므로, 줄에 `part: "log"`를 달아 구독 모듈이 그 런의 `["runs", "detail", id]`만 무효화하게 갈랐다. 대상 종류는 C12의 여섯 그대로다. 런 시작 때 `tracker` 줄(In Progress로 옮기기)과 끝날 때 결과 댓글의 `tracker` 줄은 런 하나에 2개이고, 줄마다 열린 Tickets·Settings 탭의 트래커 query를 한 번 다시 읽게 한다. 0122 서버 캐시는 세대가 올라 그 다시 읽기가 트래커를 한 번 기다린다(같은 읽기는 서버가 한 번만 부름). webhook이 없는 설치에서 Tickets의 티켓 상태가 5분 동안 낡지 않게 하려는 스펙 5.2의 의도대로 그대로 둔다.

## 머지 위험

DB 스키마를 바꾸는 one-way 변경이고, `packages/db` 쓰기 함수와 worker·web·MCP가 모두 닿아 blast radius가 크다. 사람이 병합한다.
