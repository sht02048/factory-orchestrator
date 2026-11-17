---
status: todo
blocked_by: [0004]
---

# db 스키마, 마이그레이션, 암호화 저장, 부팅 설정

## 목표

web과 worker가 함께 쓰는 SQLite(WAL) 저장소를 만든다. 런·설정·토큰·요청이 여기 모이고, 업데이트 때 마이그레이션이 자동으로 돈다.

## 범위

- 이 티켓은 `packages/db`와 루트 `.env.example`만 고친다(네이티브 SQLite 모듈을 고르면 `pnpm-workspace.yaml`의 `allowBuilds`도). 뒤 티켓(0016~0018, 0022, 0027)이 쓰는 스키마도 여기서 모두 만든다. 그 티켓들이 `packages/db`를 고치지 않게 하기 위해서다.
- SQLite(WAL) 연결과 마이그레이션 실행 함수. 같은 마이그레이션을 두 번 돌려도 안전하다(ADR 0005).
- 스키마: Tracker Connection, GitHub 토큰(설치 단위), Runner(ssh 대상, orca 경로, capacity, 마지막 상태 확인, 그 러너가 가진 러너 쪽 프로젝트 목록), Workspace(이름, 최대 실행 시간, "In Progress" 상태), Workspace의 트래커 프로젝트, Mapping, Auto-assign Label, Run(티켓 키, Workspace, 트래커 프로젝트, 러너 쪽 프로젝트, 상태(Disconnected 포함), 에이전트 결과, 런이 끝난 때 PR 상태, 할당·시작·종료 시각, 러너(Offline 예외로 비울 수 있음, Q68·Q72), 에이전트, 브랜치, 워크트리 참조, Orca 시작 핸들(`operationId`, `--retry-launch`용), PR과 그 CI 상태, 워크트리를 지운 시각(worker가 지웠거나 사람이 지운 것을 확인한 때, Q75), 트래커 갱신 기록("In Progress"로 바꾼 시각, 결과 댓글을 단 시각), 이후 PR 상태(Q54·Q69), ssh 연속 실패가 시작된 시각(Q50), 마지막 로그 200줄), 런 상태 변경 이력(Waiting for Input·Disconnected 들어감·나옴 시각 포함, Q52·Q67), 검증을 통과한 webhook 이벤트(Tracker Connection, 트래커 프로젝트, 종류, 티켓 키, 라벨, 받은 시각, 처리 여부)와 중복 제거 키(`Linear-Delivery`), web이 남기는 요청(로그 꼬리, 러너 확인, 런 취소)과 그 결과(Q46·Q54·Q61·Q77).
- 토큰(Linear API 키, webhook signing secret, GitHub 토큰) 암호화 저장과 복호화. 키는 부팅 설정에서 받는다(ADR 0005).
- 부팅 설정 읽기: 포트, 데이터 경로, 암호화 키, 바인딩 주소를 환경 변수에서 스키마로 파싱한다. `.env.example`을 이 넷만 남기게 정리한다(Q58). `apps/web`이 이미 읽는 `WEB_HOST`·`WEB_PORT` 이름은 바꾸지 않는다. 바인딩 주소 기본값은 `127.0.0.1`(스펙 8절).
- 런 상태 변경은 core 상태 전이 함수를 거친다. 요약 결과, Failed 사유, 워크트리 처리는 컬럼으로 두지 않는다. 필요할 때 core 요약 계산 함수로 계산한다(Q66·Q71).
- 할당 진입점: 티켓·러너 쪽 프로젝트·에이전트(와 운영자가 고른 러너)를 받아 core 할당 조건(티켓당 런 하나, Q45)을 확인하고, 운영자가 러너를 고르지 않았으면 core 규칙으로 러너를 고른 뒤(Q53) Run을 Queued로 만드는 함수. 고를 Online 러너가 없으면 러너 없이 Queued로 만든다(Q65). web의 수동 할당(0021)과 worker의 자동 할당(0018)이 함께 쓴다.

## 완료 조건

- 빈 파일에서 마이그레이션을 돌리면 스키마가 생기고, 다시 돌려도 바뀌지 않는다는 테스트가 통과한다.
- 저장한 토큰이 DB 파일에 평문으로 남지 않고, 같은 키로 복호화된다는 테스트가 통과한다.
- 할당 진입점이 러너 쪽 프로젝트가 있는 Online 러너 중 남은 capacity가 가장 많은 러너를 런에 적는다는 테스트가 통과한다.
- 진행 중(Running, Waiting for Input, Disconnected)이거나 Queued인 런이 있는 티켓에 할당 진입점을 부르면 런이 생기지 않는다는 테스트가 통과한다(Q74).
- Run 테이블에 요약 결과·Failed 사유 컬럼이 없고, 두 축을 저장하고 읽을 수 있다는 테스트가 통과한다.
- 필수 부팅 값이 빠지거나 형식이 틀리면 어느 값인지 알리며 실패하는 테스트가 통과한다.
- `.env.example`에 토큰 변수가 없다.
