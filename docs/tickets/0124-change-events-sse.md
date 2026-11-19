---
status: todo
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
2. **쓰는 곳(같은 트랜잭션).** `packages/db`의 쓰기 함수 안에서 줄을 써서 web·worker·MCP 어느 프로세스가 불러도 빠지지 않게 한다. 스펙 5.2의 표를 따른다.
   - run: 상태 바뀜과 Paused, PR·CI 바뀜, Question·Permission 생김과 답·거절, 취소·멈추기·재개·로그 요청과 처리 결과, 티켓 제목 채움. 0120이 더한 쓰는 곳도 찾는다.
   - runner: 점검 결과와 Online/Offline, 공급자 사용량, 러너 저장·capacity.
   - assignment: 새 런(자동, 수동, MCP).
   - workspace: Workspace 더하기·지우기·이름.
   - settings: 그 밖의 Settings 쓰기 모두(0119 뒤 모양), Mapping, Auto-assign Label, In Progress 상태, 트래커 연결, 설치 전체 설정, MCP 쓰기 허용.
   - tracker: 트래커 webhook을 받음, "Linear에서 다시 읽기", 라벨 만들기, 트래커 연결이나 Workspace의 트래커 프로젝트가 바뀜. 한 쓰기가 둘 이상에 해당하면 줄을 둘 이상 쓴다(스펙 5.2).
   - "Linear에서 다시 읽기"는 지금 클라이언트의 `router.invalidate()`뿐이다. `tracker` 줄을 쓰는 서버 동작을 더한다(0122가 서버 캐시를 비우는 동작을 먼저 만들었으면 거기에 붙인다). 이 줄과 라벨 만들기의 `tracker` 줄은 트래커 API 호출 뒤에 쓰며, DB 트랜잭션에 묶이지 않는다.
   - MCP 프로세스(`ganger mcp`)의 쓰기도 같은 함수를 지나 줄을 남기는지 시험으로 확인한다.
3. **통로 `/api/change-events/stream`.** `apps/web/src/routes/api/`에 둔다. web 프로세스 하나가 1초마다 마지막 번호 뒤의 줄을 읽어 열린 연결 모두에 보낸다. 메시지는 `change`(`id`=`seq`, `{ kind, targetId, workspaceId }`), `ready`, `reset`, 15초 하트비트, `retry`. `Last-Event-ID`(또는 `?after=`)로 이어 받고, 이어 받을 수 없으면 `reset`을 보낸다(C11, 스펙 5.3). 받은 번호가 지운 번호의 상한(표에 줄이 있으면 남은 가장 작은 번호 − 1, 비었으면 `sqlite_sequence`)보다 작을 때와, 지금 가장 큰 번호보다 클 때(DB 파일을 되돌림)다. 표가 비어 있어도 판단할 수 있어야 한다. 요청 검사(Host·Origin)는 다른 웹 경로와 같다.
4. **지우기.** 하루 지난 줄을 지운다(C9). 주기를 정해 적는다.
5. **웹 구독 모듈.** 셸이 마운트될 때 연결한다. `change`를 스펙 5.4 표의 key 접두사 무효화로 바꾸고, 한 번에 온 줄은 모아 한 번 무효화한다. `reset`은 모든 query를 무효화한다. 아직 Query로 옮긴 화면이 없으므로, 구독 모듈과 대상→key 표는 시험으로 검증하고 화면 연결은 0125~0128이 한다.
6. **폴링 대비.** SSE가 끊기고 다시 붙지 않는 동안 30초마다 보이는 query를 다시 읽는다(C4). 다시 붙으면 멈춘다. 탭 복귀·재연결 다시 읽기(C6)는 Query 기본값으로 둔다.
7. **mutation 오류 타입.** 이유가 담긴 오류 타입과, 서버 함수의 `{ ok: false, reason }` 결과와 지금 throw하는 오류(`answerQuestion`·`denyPermission`)를 그 타입으로 바꾸는 함수를 `apps/web`에 둔다(C5, 스펙 4.4). 서버 함수는 바꾸지 않는다. 함께 도는 0125~0127이 이것을 쓴다.
8. **탭 여러 개.** 탭 여러 개(HTTP/1.1)에서 연결 수 한도에 닿는지 재고 결과를 스펙 0003 열린 질문 1에 적는다. 닿으면 운영자와 정한다.
9. **같은 탭의 쓰기가 돌아옴.** 쓰기가 남긴 줄이 같은 탭에 돌아와 query를 한 번 더 읽는 횟수를 재고, 줄일 방법이 필요한지 스펙 0003 8절에 적는다.

## 완료 조건

- [ ] 시험: 2번의 쓰기 함수마다 같은 트랜잭션에서 `change_events` 줄이 생기고, 트랜잭션이 롤백되면 줄도 없다.
- [ ] 시험: MCP 쓰기 도구로 바꾼 것도 줄을 남긴다.
- [ ] 시험: 통로가 `Last-Event-ID` 뒤의 줄부터 보낸다. 지운 번호(표가 빈 경우 포함)와 지금보다 큰 번호면 `reset`을 보낸다. 하루 지난 줄을 지운다.
- [ ] 시험: 오류 변환 함수가 `{ ok: false, reason }`과 throw한 오류를 같은 타입으로 바꾸고 이유를 지킨다.
- [ ] 시험: 구독 모듈이 대상마다 스펙 5.4 표의 key만 무효화하고, `reset`에 모든 query를 무효화한다.
- [ ] 시험: worker와 같은 함수로 런 상태를 바꾸면 열린 브라우저의 구독 모듈이 3초 안에 그 런의 key를 무효화한다.
- [ ] 시험: SSE가 끊기면 30초마다 다시 읽고(가짜 시계), 다시 붙으면 멈춘다.
- [ ] 0117 브라우저 시험이 그대로 통과한다.
- [ ] 되돌리는 방법을 이 티켓에 적었다(아래).

## 되돌리기

새 표를 더하는 마이그레이션이라 one-way다. 머지 전에 DB 파일을 복사해 두고, 되돌릴 때 이전 버전 앱과 그 파일로 돌아간다. 이전 버전 앱이 모르는 표가 남은 DB를 열 때 문제가 없는지(스키마 검사, `ganger mcp`의 `schemaProblem`) 확인해 여기에 적는다.

## 머지 위험

DB 스키마를 바꾸는 one-way 변경이고, `packages/db` 쓰기 함수와 worker·web·MCP가 모두 닿아 blast radius가 크다. 사람이 병합한다.
