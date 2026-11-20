# 서버 로그 스펙

web·worker·`ganger mcp`·`ganger start`가 무슨 일을 했는지 운영자와 코딩 에이전트가 나중에 읽을 수 있게 남기는 기준 문서다. 조사([research 0017](../research/0017-logging.md))와 2026-11-20 운영자 결정 L1~L12, 그리고 이 문서와 함께 쓴 ADR [0021](../adr/0021-server-log-format.md)을 한곳에 묶는다. L1~L12는 12절에 운영자가 정한 문장 그대로 두었다. 본문은 그 결정을 코드 위치에 맞춰 풀어 쓴 것이고 새 결정을 만들지 않는다. 근거 문서에 없는 것은 「열린 질문」에 남긴다.

용어는 [GLOSSARY](../../GLOSSARY.md)를 따른다(서버 로그, 런 타임라인, 진단 묶음). 이 문서를 쪼갠 티켓은 [0132](../tickets/0132-server-log-module.md)(로그 모듈과 프로세스별 파일), [0133](../tickets/0133-log-viewing.md)(보는 길), [0134](../tickets/0134-log-settings-diagnostics.md)(Settings와 진단 묶음)이다.

## 1. 목표와 완료 기준

목표: 런이 왜 멈췄는지, webhook이 왜 할당으로 이어지지 않았는지, 러너가 왜 닿지 않았는지를 운영자가 터미널·launchd·systemd·데스크톱 어느 방식으로 띄웠든 같은 곳에서 같은 모양으로 읽는다. 코딩 에이전트도 파일 경로를 몰라도 런·티켓 단위로 읽는다(0133). 로그가 비밀이나 티켓 본문을 퍼뜨리지 않는다.

완료 기준(0132):

- web·worker·mcp·cli가 `<home>/logs/{web,worker,mcp,cli}.jsonl`에 JSON Lines로 쓴다. 실행 방식과 상관없이 같다.
- 한 줄은 고정 키(3절)로 시작하고 `event`마다 `msg`가 고정이다.
- 기본 수준 info에서 info 줄은 4절 목록의 바뀐 일만이다. 바뀐 것이 없는 tick은 info를 쓰지 않는다.
- 비밀 키 이름과 토큰 모양 문자열은 가리고, 티켓 본문·에이전트 브리프·환경 변수는 쓰지 않는다(5절).
- 파일은 10MB에서 회전하고 회전본은 5개까지 둔다. 여러 번 넘쳐도 파일 수가 늘지 않는다(6절).
- 쓰는 도중 프로세스가 죽어도 앞 줄은 깨지지 않고, 다음 프로세스는 새 줄에서 시작한다.
- `ganger mcp`는 stdout에 로그를 쓰지 않는다.
- `pnpm run smoke:bundle`이 서버 배포물을 띄워 세 파일에 `process.started`가 생기는지 확인한다.

## 2. 범위와 제외

0132(이 PR):

- 로그 모듈 `@ganger/log`(`packages/log`): 줄 만들기, 수준 거르기, 가리기, 회전, 상관 문맥, 콘솔 정책, 죽음 처리. 라이브러리 없이 `node:fs`와 `AsyncLocalStorage`만 쓴다(L8).
- 배선: web(`apps/web/src/server.ts`), worker(`apps/worker/src/main.ts`), `ganger start`·`ganger mcp`(`apps/cli/src/cli.ts`의 `setupLog`).
- 지금의 `logger.warn`·`console.warn` 호출을 새 모듈로 옮기기.
- 4절의 info 줄, 러너 호출 debug·info 줄, tick 요약 debug 줄, 10분 생존 줄.
- 기존 출력 파일(`ganger.log`, `desktop-server.log`) 회전(L9).
- `ganger start`가 자식 출력을 조각(chunk)이 아니라 줄 단위로 넘기기.

0133: `ganger logs` CLI, 런 타임라인 읽기 함수, 읽기 전용 MCP 도구.

0134: Settings(로그 크기 표시, 로그 폴더 열기, 진단 묶음 만들기, debug 스위치), 진단 묶음과 익명화, 브라우저 오류(error)를 서버 함수로 받기.

제외(L5·L7·L10): 웹 로그 뷰어, 외부 오류 추적(Sentry), 로그 지우기 버튼, OpenTelemetry.

## 3. 한 줄 형식

```json
{
  "t": "2026-11-20T09:12:03.412+09:00",
  "level": "info",
  "proc": "worker",
  "pid": 4121,
  "v": "0.1.0",
  "event": "runner.call",
  "msg": "called the runner",
  "runId": "run-1",
  "runnerId": "runner-1",
  "verb": "orchestration worker-start",
  "ms": 1840,
  "exit": 0,
  "outcome": "ok"
}
```

고정 키(이 순서로 먼저 온다, ADR 0021):

| 키      | 뜻                                                                                   |
| ------- | ------------------------------------------------------------------------------------ |
| `t`     | ISO 8601, 밀리초와 로컬 오프셋 포함                                                  |
| `level` | `error`·`warn`·`info`·`debug`                                                        |
| `proc`  | `web`·`worker`·`mcp`·`cli`·`desktop`                                                 |
| `pid`   | 프로세스 id                                                                          |
| `v`     | Ganger 버전(루트 `package.json`)                                                     |
| `event` | 점으로 나눈 고정 이름(`webhook.received`). 목록은 `packages/log/src/events.ts` 한 곳 |
| `msg`   | `event`마다 정해진 영어 문장. 값을 끼워 넣지 않는다(L11)                             |

문맥 키(있을 때만): `runId`, `ticketKey`, `runnerId`, `workspaceId`, `trackerConnectionId`, `codeHostConnectionId`, `deliveryId`, `requestId`, `orcaRunId`, `worktreeName`, `prId`, `tool`. 세부 키(`verb`, `ms`, `exit`, `outcome`, `reason`, `kind`, `from`, `to`, `online`, `count`, `watched` 등)는 `packages/log/src/fields.ts`의 목록만 쓴다. 목록에 없는 키와 문자열·숫자·참거짓·null이 아닌 값은 줄에 들어가지 않는다. 타입이 호출 자리에서 막고, 실행 중에도 한 번 더 거른다.

오류는 `err: {name, message, code?, kind?, detail?, stack?, cause?}`. `AdapterError`의 `detail.kind`를 `kind`로, `detail`·`message` 문자열을 `detail`로 펼친다(500자). `malformed-output`의 `raw`처럼 원격 출력 전체는 넣지 않는다. `cause`는 3단계까지.

상관 문맥(L12): `withLogContext(문맥, fn)`이 `AsyncLocalStorage`로 그 안의 모든 줄에 문맥 키를 붙인다. 붙이는 곳:

- web: 요청마다 `requestId`(`serve-request.ts`). webhook 줄은 `trackerConnectionId`·`deliveryId`·`ticketKey`를 직접 단다.
- worker: 런 하나를 지켜보거나 뒤처리할 때 `runId`·`ticketKey`·`runnerId`·`workspaceId`·`worktreeName`(`watch.ts`, `after-run.ts`), 런을 시작할 때 `runId`·`runnerId`, 러너 점검 때 `runnerId`, 트래커 이벤트를 처리할 때 `deliveryId`·`trackerConnectionId`·`ticketKey`, 런 제어 요청 때 `runId`.
- 프로세스 사이: trace를 넘기지 않는다. DB 행의 id(`deliveryId`, `runId`)가 상관 id다. 할당이 webhook에서 비롯되면 할당 줄에 `deliveryId`가 붙는다.
- 원격 러너: `OrcaRunner.run()` 한 곳의 `runner.call` 줄이 `verb`, `ms`, `exit`, `outcome`, worker-start면 `orcaRunId`·`worktreeName`을 남긴다. 러너 쪽 Orca 워크트리와는 `worktreeName`으로 잇는다. stdin(브리프)과 stdout 본문은 남기지 않고, 실패 때 stderr 앞 500자만 `reason`에 가려서 남긴다.

## 4. 수준 기준과 info 줄

| 수준  | 기준(L2)                                                      |
| ----- | ------------------------------------------------------------- |
| error | 코드 결함, 처리 안 된 예외, 프로세스가 곧 멈춤                |
| warn  | 바깥 실패라 스스로 다시 시도하지만 운영자가 손써야 할 수 있음 |
| info  | 바뀐 것만                                                     |
| debug | 켤 때만. 모든 러너 호출, tick 요약                            |

info 줄 목록:

| event                                | 어디서                         | 무엇                                                                                                                                                    |
| ------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `process.started`                    | 네 프로세스 시작               | node·platform·arch, worker는 적용한 마이그레이션 수                                                                                                     |
| `process.stopping`·`process.stopped` | 정지 신호와 끝                 | 신호 이름                                                                                                                                               |
| `supervisor.child_exited`            | `ganger start`                 | 멈추라고 해서 끝난 자식(예기치 않게 끝나면 warn)                                                                                                        |
| `webhook.received`                   | web `receive.ts`               | webhook 하나 처리 끝: `deliveryId`, `ticketKey`, 종류, `outcome`(recorded·duplicate), `ms`. 본문은 쓰지 않는다                                          |
| `run.assigned`                       | db `assignRun`                 | 할당 결정: 런·티켓·Workspace·러너·저장소, `reason`(picked·chosen)                                                                                       |
| `run.runner_chosen`                  | db `setQueuedRunRunner`        | Queued 런의 러너가 바뀜                                                                                                                                 |
| `run.state_changed`                  | db `changeRunState`            | 런 상태 옮김 `from`·`to`, Ended면 에이전트 결과                                                                                                         |
| `runner.online_changed`              | db `recordRunnerCheck`         | 러너 Online↔Offline이 바뀜                                                                                                                              |
| `runner.call`                        | runner-orca `OrcaRunner.run()` | 러너 쓰기 호출. 쓰기 동사는 `runner-call-log.ts`의 `WRITE_VERBS` 목록(worker-start, 답 보내기, 멈추기, 워크트리 지우기 등)이고 목록에 없는 호출은 debug |
| `process.alive`                      | worker, 10분마다               | 지켜보는 런 수, 마지막 tick ms, 가동 초                                                                                                                 |

db의 세 줄은 `onCommit`으로 바깥 트랜잭션이 커밋된 뒤에 쓴다. 롤백된 변경은 줄을 남기지 않는다.

debug 줄: `runner.call`(읽기), `worker.tick`(`ms`, `watched`). 나머지 warn 줄은 지금까지의 경고 문장을 그대로 `msg`로 두고 이름만 붙였다(`run.watch_failed` 등).

수준 바꾸기(L3): `GANGER_LOG_LEVEL`(`error`·`warn`·`info`·`debug`, 대소문자 무시, 그 밖의 값은 info). 로거는 줄마다 수준을 다시 읽고 `setupProcessLog`가 돌려주는 `setLevel`로 바꿀 수 있어, 0134의 Settings 스위치가 재시작 없이 바꾼다.

## 5. 가리기(L6)

- 키 이름에 `token`, `secret`, `password`, `authorization`, `cookie`, `signature`, `apiKey`, `privateKey`, `credential`, `encryptionKey`가 들어가면(대소문자 무시, 오류 `cause` 안 객체 포함) 값을 `[redacted]`로 바꾼다.
- 모든 문자열(필드, 오류 메시지·스택·detail)에서 토큰 모양을 지운다: `Bearer …`, `Basic …`, `lin_api_…`·`lin_oauth_…`, `ghp_…` 등 GitHub 토큰, `github_pat_…`, Slack `xox?-…`, `sk-…`, Expo 푸시 토큰, JWT, PEM 개인 키, URL의 `user:password@`.
- 아예 쓰지 않는 것: webhook 본문, 티켓 본문·설명, 에이전트 브리프·프롬프트, 에이전트 로그 줄, 환경 변수, 설정 원문. 3절의 키 목록이 이것들을 막는다.
- 로컬 파일에는 티켓 키와 러너 이름·id를 그대로 둔다. 운영자 자기 기기다. ssh 대상·호스트·홈 경로·티켓 키 접두어 익명화는 진단 묶음을 만들 때 한다(0134).

## 6. 파일 위치와 회전(L1, L9)

- `<home>/logs/web.jsonl`, `worker.jsonl`, `mcp.jsonl`, `cli.jsonl`. `<home>`은 `GANGER_HOME`이다. `ganger start`가 자식에게 넘긴다. `pnpm dev`처럼 `GANGER_HOME`이 없으면 파일을 쓰지 않는다.
- 콘솔: web·worker는 warn 이상만 stderr에 사람이 읽는 한 줄(`HH:MM:SS WARN [worker] could not watch run runId=…`)로 쓴다. `ganger start`·`ganger mcp`는 error만 stderr에 쓴다(`start`는 이미 자기 문장을 쓰고, MCP 규격상 stdout은 MCP 메시지 전용이다).
- 쓰기: 줄마다 한 번의 동기 `write`. 함수가 돌아오면 줄은 디스크에 있다. 파일을 열 때 마지막 바이트가 줄바꿈이 아니면(앞 프로세스가 쓰다 죽음) 줄바꿈을 먼저 쓴다.
- 회전: 쓰려는 줄을 더해 `GANGER_LOG_MAX_MB`(기본 10)를 넘으면 `.N`을 `.N+1`로 밀고 `GANGER_LOG_FILES`(기본 5)번째를 지운 뒤 지금 파일을 `.1`로 옮긴다. 0이면 회전본 없이 지운다. 같은 파일을 두 프로세스가 쓸 때(`ganger mcp` 여럿) 다른 쪽이 이미 옮겼으면(경로의 inode가 열린 파일과 다르면) 다시 열기만 한다.
- 기존 출력 파일: `ganger start`가 시작할 때 `<home>/logs/ganger.log`(launchd `StandardOutPath`)가 한도를 넘으면 `.1`로 복사하고 비운다(launchd가 파일을 연 채로 붙잡고 있어 옮기면 안 된다). 데스크톱은 서버를 띄우기 전에 `desktop-server.log`를 `.1`로 옮긴다.
- 죽음(L7): 네 프로세스가 `uncaughtException`·`unhandledRejection`에서 `process.crashed` error 줄을 동기로 쓰고 1로 끝낸다(감독자가 다시 띄운다). `process.report`를 `reportOnFatalError`, `excludeEnv`, 디렉터리 `<home>/logs/reports`로 두고 시작할 때 최근 3개만 남긴다. 플래그 대신 실행 중 API로 켜서 데스크톱(Electron을 Node로 쓰는 실행)에서도 같다.

## 7. 시험

| 무엇                                                                                                                        | 어디                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 줄 형식(고정 키와 순서, 로컬 오프셋 시각, `msg` 고정, `event` 이름 모양, 오류 직렬화)                                       | `packages/log/src/logger.test.ts`                                                               |
| 수준 거르기, 줄마다 다시 읽기, 콘솔은 warn 이상, 환경 변수                                                                  | 같은 곳                                                                                         |
| 가리기: 토큰 모양, 비밀 키 이름(중첩), 목록 밖 키(본문·브리프·환경 변수)                                                    | 같은 곳                                                                                         |
| 상관 문맥이 `await`·타이머·`setImmediate`를 넘고 동시 흐름끼리 섞이지 않음                                                  | 같은 곳                                                                                         |
| mcp는 stdout에 쓰지 않음, 홈이 없으면 파일 없음, 죽음 처리                                                                  | 같은 곳                                                                                         |
| 회전: 여러 번 넘쳐도 파일 수 유지, 0개, 환경 변수, 동시 쓰기 뒤 모든 줄이 온전함, 죽은 뒤 이어 쓰기, 쓰자마자 디스크에 있음 | `packages/log/src/file-sink.test.ts`                                                            |
| 기존 출력 파일 회전                                                                                                         | `file-sink.test.ts`, `apps/cli/src/start.test.ts`, `apps/desktop/src/core/local-server.test.ts` |
| info 줄이 커밋 뒤에만, 롤백이면 없음, Online 바뀔 때만                                                                      | `packages/db/src/log-lines.test.ts`                                                             |
| webhook 줄(배달 id·티켓·결과, 본문 없음)                                                                                    | `apps/web/src/webhooks/receive.test.ts`                                                         |
| 러너 호출 줄(읽기 debug, 쓰기 info, 결과 분류, 본문 없음)                                                                   | `packages/runner-orca/src/runner-call-log.test.ts`                                              |
| 자식 출력 줄 단위, 자식 끝남 줄                                                                                             | `apps/cli/src/start.test.ts`                                                                    |
| 배포물에서 파일이 생김                                                                                                      | `scripts/smoke-cli.ts`(`smoke:cli`, `smoke:bundle`)                                             |

## 8. 위험

- **srvx 요청 줄.** srvx `--prod`가 요청마다 stdout에 한 줄을 쓴다. launchd에서는 `ganger.log`로 가 L1의 "stdout에는 warn 이상만"과 어긋난다. srvx CLI에 끄는 옵션이 없다. `ganger.log`는 `ganger start`가 시작할 때만 회전하므로(L9) 서비스가 오래 도는 동안은 묶이지 않고 다시 시작할 때 묶인다. 끄려면 srvx를 CLI 대신 코드로 띄워야 한다(열린 질문).
- **db 패키지가 로그를 쓴다.** `run.state_changed` 같은 줄은 어느 프로세스든 `changeRunState`를 부른 쪽의 파일에 남는다(웹 화면에서 취소하면 `web.jsonl`). `ganger logs`(0133)가 파일을 합쳐 보이므로 괜찮다고 봤다.
- **`onCommit`은 `inTransaction`으로 연 트랜잭션만 안다.** 다른 방법으로 연 트랜잭션 안에서 부르면 바로 쓴다. 지금 그런 코드는 없다.
- **같은 파일을 여러 프로세스가 쓴다.** `ganger mcp`는 클라이언트마다 하나라 `mcp.jsonl`을 함께 쓴다. 한 줄은 `O_APPEND` 쓰기 한 번이라 섞이지 않지만, 두 프로세스가 동시에 넘치면 회전이 한 번 더 일어날 수 있다(줄은 잃지 않고 오래된 회전본 하나가 먼저 지워진다).
- **가리기는 완전하지 않다.** 모양을 모르는 비밀은 지나갈 수 있다. 그래서 키 목록으로 본문·설정 원문을 아예 막고, 진단 묶음은 한 번 더 익명화하고 공개 전에 직접 보라고 안내한다(0134).

## 9. 열린 질문

- srvx 요청 줄을 끌지(위 위험 1). 끄면 서버 시작 코드를 바꿔야 한다.
- `ganger start`가 자식 출력을 넘기는 `onOutput`은 지금 시험만 쓴다. 데스크톱이나 서비스가 이것을 쓸지는 0133·0134에서 정한다.

## 10. 이행 순서

0132(이 문서와 모듈) → 0133(보기) → 0134(Settings, 0128 Query Settings 뒤).

## 11. 보안

- 로그 파일은 `0600`, 새로 만드는 `<home>/logs` 폴더는 `0700`으로 만든다. 홈 권한이 느슨한 서버에서도 다른 계정이 읽지 못한다.
- 진단 묶음은 이슈에 붙이는 용도라 익명화를 기본으로 켠다(L6, 0134).

## 12. 운영자 결정 목록(2026-11-20)

운영자가 정한 문장 그대로다. 모두 조사 추천대로 승인했다.

| 번호 | 결정                                                                                                                                                                                                                                                       |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1   | 파일: web·worker·mcp 가 각자 `<home>/logs/{web,worker,mcp}.jsonl` 에 JSON Lines 로 직접 쓴다. 실행 방식(터미널·launchd·systemd·데스크톱)과 상관없이 같다. stdout 에는 사람이 읽는 warn 이상만(mcp 는 stdio 규격상 stdout 에 쓰지 않는다).                  |
| L2   | 수준: 기본 info. info 는 바뀐 것만(시작·정지, webhook 처리, 할당 결정, 런 상태 옮김, 러너 쓰기 호출, 10분마다 생존 줄). debug 는 모든 러너 호출과 tick 요약. error 는 결함, warn 은 바깥 실패라 운영자가 손써야 할 수 있는 것.                             |
| L3   | debug 는 켤 때만 남긴다. 켜는 법: `GANGER_LOG_LEVEL` 환경 변수, 그리고 재시작 없는 Settings 스위치(0134).                                                                                                                                                  |
| L4   | 디버그 로그는 DB 에 넣지 않는다. 도메인 사실은 기존 표를 시각순으로 합친 "런 타임라인"(0133).                                                                                                                                                              |
| L5   | 보는 길: `ganger logs` CLI(합쳐 보기·런/티켓 거르기·follow), 읽기 전용 MCP 도구(런/티켓 단위 타임라인+로그), 진단 묶음 zip(0133·0134). 웹 로그 뷰어는 나중.                                                                                                |
| L6   | 가리기: 비밀 키 이름·토큰 모양 문자열은 늘 가린다, 티켓 본문·에이전트 브리프·환경 변수는 아예 쓰지 않는다. 로컬 파일에는 티켓 키·러너 이름을 그대로 남긴다. 진단 묶음은 ssh 대상·호스트·홈 경로·티켓 키 접두어를 기본으로 익명화하고 끌 수 있다(0134).     |
| L7   | 브라우저 오류(error)만 서버 함수로 받아 web 로그에(0134). 외부 오류 추적(Sentry) 없음. `uncaughtException`·`unhandledRejection` 때 동기로 error 줄, Node `--report-on-fatalerror --report-exclude-env`.                                                    |
| L8   | 라이브러리 없이 작은 자체 모듈(node:fs, AsyncLocalStorage). pino 를 쓰지 않는 이유는 번들(`pnpm run bundle`)과 worker thread transport 부담, 로그 양이 적음.                                                                                               |
| L9   | 회전: 파일 10MB 넘으면 `.1` 로 밀고 5개 넘으면 가장 오래된 것을 지움. `GANGER_LOG_MAX_MB`·`GANGER_LOG_FILES` 환경 변수로만 바꿈. 기존 `ganger.log`(launchd)·`desktop-server.log` 도 시작 전 크기가 넘으면 옮긴다.                                          |
| L10  | Settings 에는 로그 크기 표시, 로그 폴더 열기, 진단 묶음 만들기, debug 스위치(0134). 로그 지우기 버튼은 두지 않는다.                                                                                                                                        |
| L11  | 로그 문구는 영어 고정 문자열(메시지 파일 아님), `event` 키에 점 이름(예: `webhook.received`), 고정 `msg`.                                                                                                                                                  |
| L12  | 상관 id: AsyncLocalStorage 로 runId·ticketKey·runnerId·deliveryId·requestId 를 자동으로 붙인다. 프로세스 사이는 DB 행 id 를 상관 id 로, 원격 러너와는 `OrcaRunner` 호출 한 곳의 canonical 줄(verb, ms, exit, outcome, orca 쪽 id, worktree 이름)로 잇는다. |

L1은 web·worker·mcp를 적었고, `ganger start`의 감독 줄도 같은 모듈로 `cli.jsonl`에 쓴다(`proc: "cli"`). L7의 Node 플래그는 실행 중 API(`process.report`)로 같은 설정을 켠다(6절).
