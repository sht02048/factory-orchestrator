---
status: done
blocked_by: []
---

# 0132 서버 로그: 로그 모듈과 프로세스별 파일

## 목표

web·worker·`ganger mcp`·`ganger start`가 실행 방식과 상관없이 `<home>/logs/{web,worker,mcp,cli}.jsonl`에 같은 모양의 서버 로그를 남긴다. 스펙 [0004](../spec/0004-server-logs.md), ADR [0021](../adr/0021-server-log-format.md), 조사 [research 0017](../research/0017-logging.md), 운영자 결정 L1~L12(2026-11-20).

## 배경

경고는 `console.warn("[worker] …")`로만 남았고 실행 방식에 따라 터미널, launchd `ganger.log`, journald, 데스크톱 `desktop-server.log`로 흩어졌다. 회전이 없었고, `ganger start`는 자식 출력을 줄이 아니라 조각 단위로 넘겼다. 런이 왜 멈췄는지 볼 줄(할당 결정, 상태 옮김, 러너 호출)이 없었다.

## 할 일

1. 로그 모듈 `@ganger/log`(`packages/log`): 줄 만들기(고정 키), 수준 거르기, 가리기, 회전, `AsyncLocalStorage` 상관 문맥, 콘솔 정책, 죽음 처리. web·worker·cli·desktop·db·runner-orca가 함께 쓴다. 브라우저 번들에 들어가지 않도록 `core`가 아닌 새 패키지에 둔다.
2. 배선: web 서버 진입점, worker `main.ts`, `ganger start`·`ganger mcp`(`cli.ts`의 `setupLog`). 시험에서 부르는 `runProgram`은 로그를 켜지 않는다.
3. 지금의 `logger.warn`·`console.warn` 호출을 새 모듈로 옮긴다. 문장은 `msg`로 두고 `event` 이름을 붙인다.
4. info 줄: `process.started`·`process.stopping`·`process.stopped`, `webhook.received`, `run.assigned`·`run.runner_chosen`·`run.state_changed`(커밋 뒤), `runner.online_changed`, 러너 쓰기 호출 `runner.call`, 10분 생존 줄 `process.alive`. debug: 러너 읽기 호출, `worker.tick`.
5. 상관 문맥: web 요청 `requestId`, worker 런·러너·트래커 이벤트·런 제어 단위.
6. 죽음: `uncaughtException`·`unhandledRejection`에서 동기 error 줄 뒤 종료, `process.report`(fatal error, 환경 변수 제외, `<home>/logs/reports`, 최근 3개).
7. 회전: 10MB·5개, `GANGER_LOG_MAX_MB`·`GANGER_LOG_FILES`. 기존 `ganger.log`(복사 후 비우기)·`desktop-server.log`(옮기기)도 시작 전에.
8. `start.ts`가 자식 출력을 줄 단위로 넘긴다.
9. 스펙·ADR·조사·GLOSSARY(서버 로그, 런 타임라인, 진단 묶음)와 후속 티켓 0133·0134.

## 완료 조건

- [x] 시험: 줄 형식(고정 키와 순서, 시각, `msg` 고정, `event` 이름 모양, 오류 직렬화).
- [x] 시험: 수준 거르기, 줄마다 수준 다시 읽기, 콘솔은 warn 이상, `GANGER_LOG_LEVEL`.
- [x] 시험: 가리기(토큰 모양, 비밀 키 이름과 중첩, 목록 밖 키라 본문·브리프·환경 변수가 안 남음).
- [x] 시험: 회전(여러 번 넘쳐도 파일 수 유지, 0개, 환경 변수), 동시 쓰기 뒤 모든 줄이 온전함, 죽은 뒤 이어 쓰기, 쓰자마자 디스크에 있음.
- [x] 시험: 상관 문맥이 `await`·타이머·`setImmediate`를 넘고 동시 흐름끼리 섞이지 않음.
- [x] 시험: mcp가 stdout에 쓰지 않음.
- [x] 시험: db info 줄은 커밋 뒤에만, 롤백되면 없음, Online이 바뀔 때만.
- [x] 시험: webhook 줄, 러너 호출 줄(읽기 debug·쓰기 info·결과 분류·본문 없음), 자식 출력 줄 단위, 자식 끝남 줄, 기존 출력 파일 회전.
- [x] `smoke:cli`·`smoke:bundle`이 `web`·`worker`·`cli`·`mcp` 파일에 `process.started`(worker·cli는 `process.stopped`도)가 생기는지 확인한다.

## 되돌리기

DB 마이그레이션이 없다. 이 PR을 되돌리면 로그가 예전처럼 콘솔로만 간다. 이미 쓴 `<home>/logs/*.jsonl`은 남아도 아무 것도 읽지 않는다. two-way다.

## 머지 위험

two-way. 여섯 패키지가 로그 모듈을 쓰고 worker의 경고 호출 전부를 바꿔 닿는 곳은 넓지만, 동작은 로그 출력만 바뀐다.
