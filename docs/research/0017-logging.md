# Ganger 로깅·관측 방법 조사

이 조사를 바탕으로 운영자가 2026-11-20 정한 것(L1~L12)은 스펙 [0004](../spec/0004-server-logs.md)와 ADR [0021](../adr/0021-server-log-format.md)에 있다. 이 문서는 조사 당시 그대로 두고, 결정과 다른 곳은 스펙이 앞선다(예: 데스크톱·launchd 출력 파일의 회전 한도는 4.4의 5 MB가 아니라 L9의 10 MB).

작성 2026-11-20. 근거 표시: **[확인]** 은 1차 자료(공식 문서·원저자 글)나 저장소 코드에서 직접 읽은 것, **[추론]** 은 그것을 바탕으로 한 판단이다. 저장소 사실은 `develop` 99b58b8 기준이다.

## 0. 지금 상태 (저장소에서 확인한 것)

- web: `consoleWebhookLogger`가 `console.warn("[web] ...", fields)`로 쓴다(`apps/web/src/webhooks/receive.ts`). 그 밖에 `console.warn` 3곳(`server/database.ts` 변경 기록 정리 실패, `change-events/feed.ts` 읽기 실패, `server/request-access.ts` 접근 거부). [확인]
- worker: `WorkerLogger`(`warn`만)를 context로 주입한다. `runId`를 필드로 붙이는 곳이 많다(`apps/worker/src/watch.ts`, `context.ts`). `main.ts`는 `console.info("[worker] ...")`. [확인]
- `ganger start`는 web·worker를 `spawn`하고 stdout/stderr를 `inherit`하거나 `onOutput(spec.name, chunk)`로 넘긴다(`apps/cli/src/start.ts`). 줄 단위가 아니라 chunk 단위다. [확인]
- launchd plist는 `StandardOutPath`/`StandardErrorPath`를 둘 다 `<home>/logs/ganger.log`로 둔다. systemd user unit은 따로 지정하지 않아 journald로 간다(`apps/cli/src/service.ts`). [확인]
- 데스크톱은 `openSync(logFile, "a")`로 연 fd를 서버 stdout으로 준다(`apps/desktop/src/core/local-server.ts`). 회전·크기 제한이 없다. "로그 열기"(`open-log.ts`)가 이미 있다. [확인]
- `ganger mcp`는 stdio MCP다. MCP 규격상 stdout에는 MCP 메시지 말고 아무것도 쓰면 안 되고, 로그는 stderr에 쓸 수 있다. [확인, MCP spec]
- DB: WAL, `synchronous=NORMAL`, busy timeout 5초, 쓰기는 `BEGIN IMMEDIATE`(`packages/db/src/database.ts`). [확인]
- 이미 있는 "무슨 일이 있었나" 표: `run_state_changes`(런 상태 옮김), `tracker_events`(webhook 배달 id·종류·티켓·받은/처리 시각), `mcp_actions`(MCP 도구 호출·결과·이유), `notification_events`(7일), `change_events`(하루), `log_tail_requests`, `runs`의 `startError`·`unreachableSince`·`runnerUnreached` 등. [확인]
- `tracker_webhook_receipts`는 `develop`에 아직 없고 `ui/0130-linear-webhook-setup` 브랜치에만 있다. [확인]
- 러너 호출은 `OrcaRunner.run()` 한 곳으로 모인다(`packages/runner-orca/src/orca-runner.ts`). `worker-start`에 `--run <orca run id>`, `--name <worktreeName>`, `--comment "<ticketKey> <url>"`을 넘긴다. [확인] → 원격과 잇는 열쇠가 이미 있다.
- GLOSSARY는 "변경 로그", "이벤트(단독으로)", "dispatch" 를 피하라고 한다. 새 낱말(예: **서버 로그**, **진단 묶음**)은 GLOSSARY에 먼저 올려야 한다. [확인]

## 1. 요약 추천

1. **세 프로세스가 각자 JSON Lines 파일을 직접 쓴다.** `<home>/logs/{web,worker,mcp}.jsonl`, 프로세스 안에서 크기 기준 회전(예: 10 MB × 5개). stdout/stderr에는 사람이 읽는 한 줄(warn 이상)만 남긴다. 실행 방식(터미널·launchd·systemd·데스크톱)에 상관없이 같은 곳에 같은 모양으로 남는다. [추론]
2. **라이브러리는 pino 대신 작은 자체 모듈.** 줄 수가 적고(분당 수십 줄 수준) 번들·Electron·worker thread 문제를 피한다. `node:async_hooks`의 `AsyncLocalStorage`로 `runId`·`deliveryId`·`requestId`를 자동으로 붙인다. [추론]
3. **도메인 기록은 이미 DB에 있다. 디버그 로그를 DB에 넣지 않는다.** 대신 "런 타임라인"(기존 표를 시각순으로 합친 것)과 로그 파일의 `runId` 줄을 한데 보여 주는 읽기 도구를 만든다. [추론]
4. **"단위 일마다 한 줄"(canonical line)** 을 셋만 둔다: webhook 요청 하나, 러너 호출(ssh+orca) 하나, 런 상태 옮김 하나. 폴링 tick 요약은 debug. [추론]
5. **보는 길은 셋**: `ganger logs` CLI(필터·follow·`--json`), MCP 읽기 도구(Claude가 직접 읽음), Settings의 **진단 묶음 내려받기**(가린 값으로 만든 zip, 이슈에 붙이는 용도). OTel·Sentry·별도 수집기는 쓰지 않는다. [추론]
6. **가리기(redaction)는 허용 목록 방식**: 로그 필드는 정해 둔 키만 쓰고, 비밀 키 이름은 무조건 가리며, 진단 묶음은 한 번 더 익명화(호스트·ssh 대상·경로·티켓 접두어 해시)한다. [추론]

## 2. 방법론별 정리

| 방법                            | 무엇                                                                                                                                                                                                                                                                                                                                                                           | 언제 맞나                                    | 비용                                                                                                              | Ganger 적합도                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 구조화 로그(JSON Lines)         | 한 줄 = JSON 객체 하나, 고정 키 + 문맥 필드                                                                                                                                                                                                                                                                                                                                    | 기계(jq, 에이전트)가 읽을 때, 필드로 거를 때 | 낮음. 사람이 읽으려면 pretty 출력 필요                                                                            | **높음**                                                             |
| 로그 수준                       | error/warn/info/debug                                                                                                                                                                                                                                                                                                                                                          | 기본은 info, 문제 볼 때만 debug              | 거의 없음. 기준이 흐리면 소음                                                                                     | **높음**                                                             |
| Canonical log line / wide event | 요청(단위 일) 끝에 핵심 특성을 모두 담은 긴 한 줄. Stripe는 메서드·경로·상태·사용자·rate limit·소요 시간·DB 시간·쿼리 수·request id를 담는다 [확인, Stripe]. Honeycomb은 서비스마다 요청 하나에 "임의로 넓은" 이벤트 하나, 성숙하면 차원 ~100개 [확인, Honeycomb]. Majors의 "observability 2.0"은 넓은 구조화 이벤트를 단일 원천으로 두고 읽을 때 집계한다 [확인, charity.wtf] | 흩어진 줄을 다시 모으기 싫을 때              | 단위 일의 끝을 잡는 코드가 필요                                                                                   | **높음**(webhook, 러너 호출, 런 상태 옮김 셋만)                      |
| 상관 id + AsyncLocalStorage     | 비동기 흐름 따라 문맥을 들고 다님. `AsyncLocalStorage`는 Stable(v16.4), `run()` 권장, `enterWith()`는 이후 동기 코드로 새어 나감 [확인, Node docs]                                                                                                                                                                                                                             | 한 프로세스 안에서 여러 런·요청이 섞일 때    | 낮음. 주입식 logger 인자를 줄일 수 있음                                                                           | **높음**                                                             |
| 프로세스 간·원격 상관           | 분산 trace 대신 id를 DB 행과 원격 인자로 넘김                                                                                                                                                                                                                                                                                                                                  | 프로세스가 DB로만 이어질 때                  | 낮음                                                                                                              | **높음**(이미 `runId`·`deliveryId`·worktree 이름·orca run id가 있음) |
| OpenTelemetry                   | 표준 trace/metric/log SDK + 수집기 + 백엔드. JS에서 traces·metrics는 stable, **logs는 development** [확인, OTel JS]. 기존 로그 라이브러리에 appender를 붙이는 방식 [확인, OTel logs]                                                                                                                                                                                           | 서비스 여러 개, 수집 인프라가 있을 때        | 높음: 의존성, 수집기·백엔드 운영, 사용자가 설정해야 함                                                            | **낮음**                                                             |
| 이벤트 로그 vs 디버그 로그      | 도메인 사실(런이 Running이 됨)은 DB, 진단 문맥(ssh 몇 ms, 왜 실패)은 파일                                                                                                                                                                                                                                                                                                      | 이미 도메인 표가 있을 때                     | —                                                                                                                 | **높음**(분리 유지)                                                  |
| 오류 추적(Sentry 등)            | 예외를 모아 묶고 알림                                                                                                                                                                                                                                                                                                                                                          | 사용자 여럿, 운영팀이 있을 때                | 자체 호스팅 Sentry 최소 4코어·RAM 16 GB+스왑 16 GB·디스크 20 GB [확인, Sentry]. SaaS는 운영자 데이터가 제3자로 감 | **낮음**                                                             |
| 진단 묶음(support dump)         | 버전·설정(비밀 제외)·상태·최근 로그를 한 파일로. Home Assistant는 통합/기기 단위로 내려받고 비밀을 `**REDACTED**`로 바꾸되 "완전하다고 보장 못 하니 공개 전에 직접 보라" [확인, HA]. Tailscale `bugreport`는 PII 없는 `BUG-` 식별자를 만들고 상세는 로컬 로그에 남김, `--record`로 재현 앞뒤 표시 [확인, Tailscale]                                                            | 사용자가 이슈에 붙일 때                      | 중간(가리기 시험이 핵심)                                                                                          | **높음**                                                             |
| 비밀 가리기                     | 키 이름·경로 기준으로 값 치환/삭제. pino는 fast-redact 기반, 고정 경로 ~2% 오버헤드, 와일드카드는 크게 늘 수 있음 [확인, pino redaction]                                                                                                                                                                                                                                       | 공개 저장소 사용자가 로그를 붙여 넣을 때     | 낮음                                                                                                              | **높음**                                                             |
| `process.report`                | 스택·힙·libuv 핸들·환경 변수 등 JSON 보고서. `--report-on-fatalerror`, `--report-uncaught-exception`, `getReport()`. 환경 변수는 `--report-exclude-env`(v22.13+)로 뺌, 네트워크는 `excludeNetwork` [확인, Node docs]                                                                                                                                                           | 멈춤·메모리·핸들 누수 볼 때                  | 낮음. 환경 변수에 토큰이 들어 있을 수 있음                                                                        | **중간**(진단 묶음에 가린 요약만)                                    |
| `diagnostics_channel`           | 이름 붙은 채널 publish/subscribe. 모듈은 Stable, child_process·http·sqlite 등 내장 채널은 대부분 Experimental [확인, Node docs 최신판. Node 24에서 어느 채널이 있는지는 따로 확인 필요]                                                                                                                                                                                        | 코드 손대지 않고 계측할 때                   | 낮음~중간, 실험 API                                                                                               | **낮음**(나중에 debug 계측용)                                        |

## 3. 도구 비교

### 3.1 로그 라이브러리

|             | pino                                                                                                                                                                                                                                                                                                                             | 자체 JSON Lines 모듈                                                    | OTel SDK      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------- |
| 형식        | NDJSON, child logger, 수준, redaction 내장                                                                                                                                                                                                                                                                                       | 직접 정함(`JSON.stringify` 한 번)                                       | OTLP          |
| 파일 회전   | `pino-roll` transport(크기·주기, `limit.count`, `symlink`) [확인]                                                                                                                                                                                                                                                                | 직접 구현(크기 확인 후 rename) ~50~100줄 [추론]                         | 수집기 몫     |
| 쓰기 방식   | transport는 **worker thread**에서 돈다. 시작이 비동기라 너무 일찍 `process.exit()` 하면 잃는다, `ready` 기다려야 함. 옵션은 structured clone 가능한 값만 [확인, pino transports]                                                                                                                                                 | `fs.writeSync`/`appendFileSync` 동기 쓰기, 크래시 직전 줄도 남음 [추론] | 배치 내보내기 |
| 번들        | worker thread 때문에 **한 파일로 묶을 수 없다**. `thread-stream` worker 등 별도 파일 + `globalThis.__bundlerPathsOverrides`, esbuild는 `esbuild-plugin-pino` [확인, pino bundling]. Ganger는 web(vite/srvx)·worker·cli를 각각 빌드해 `scripts/bundle.ts`로 묶고 `smoke:bundle`로 시험한다 [확인] → 세 빌드 모두에 이 설정이 필요 | 문제 없음                                                               | 의존성 많음   |
| Electron    | 데스크톱은 서버를 `ELECTRON_RUN_AS_NODE`로 띄우므로 Node와 같다 [확인]. 문제는 번들 쪽                                                                                                                                                                                                                                           | 문제 없음                                                               | —             |
| 성능        | 빠름(목적 자체)                                                                                                                                                                                                                                                                                                                  | 줄 수가 적어 차이가 의미 없음 [추론]                                    | —             |
| Ganger 추천 | 아님(번들 비용 > 이득)                                                                                                                                                                                                                                                                                                           | **추천**                                                                | 아님          |

`util.styleText`(Node 내장 색 입히기)는 사람이 읽는 stdout 줄과 `ganger logs` pretty 출력에 쓸 수 있다. TTY가 아니면 색을 넣지 않게 한다. [추론]

### 3.2 회전·보관

| 방법                                                  | 장점                                                                                                                                  | 단점                                                                                                                                                                                                                                                                                                                           | Ganger                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| **프로세스가 직접 회전**(크기 기준, 시작할 때도 확인) | OS·실행 방식 무관, 사용자 설정 0                                                                                                      | 세 프로세스가 **같은 파일**을 쓰면 회전 경쟁 → 프로세스마다 파일을 나눠 피함 [추론]                                                                                                                                                                                                                                            | **추천**                                                                      |
| macOS newsyslog                                       | OS 기본. 형식: 파일·owner:group·mode·count·size(KB)·when·flags(`Z` gzip, `J` bzip2, `N` 신호 없음) [확인]                             | 설정 파일이 `/etc` 아래라 root 필요, 사용자 단위 설치와 안 맞음 [추론]                                                                                                                                                                                                                                                         | 아님                                                                          |
| launchd `StandardOutPath`                             | 이미 씀                                                                                                                               | 회전 없음, 파일이 계속 커짐 [추론]                                                                                                                                                                                                                                                                                             | stdout을 warn 이상으로 줄이고, CLI가 서비스 시작 전에 크기 넘으면 `.1`로 옮김 |
| logrotate `copytruncate`(Linux)                       | 열린 fd를 건드리지 않음                                                                                                               | 패키지·cron 필요, 자르는 순간 줄 유실 가능 [추론]                                                                                                                                                                                                                                                                              | 아님                                                                          |
| journald(systemd)                                     | user unit stdout이 자동으로 감. 기본 `SystemMaxUse` = 파일시스템 10%, 최대 4 GB, `MaxRetentionSec` 기본 0(시간 기준 삭제 없음) [확인] | macOS 없음                                                                                                                                                                                                                                                                                                                     | Linux 서비스의 stdout은 그대로 두고, `ganger logs`가 안내만                   |
| 데스크톱 `desktop-server.log`                         | 이미 씀                                                                                                                               | 회전 없음 [확인]                                                                                                                                                                                                                                                                                                               | 시작할 때 크기 넘으면 옮김. 서버가 자체 파일을 쓰면 여기는 작아짐             |
| **SQLite 로그 표**                                    | 쿼리·UI가 쉬움                                                                                                                        | WAL은 **쓰는 쪽이 한 번에 하나** [확인, SQLite]. 로그 한 줄마다 쓰기 잠금 경쟁, 5초 busy timeout 안에서 런 상태 트랜잭션과 다툼. 실패한 트랜잭션 **안에서** 쓴 로그는 함께 롤백됨. DB가 잠기거나 깨졌을 때가 로그가 가장 필요한 때인데 그때 못 씀. WAL이 오래 열린 reader 때문에 체크포인트를 못 하면 계속 커짐 [확인, SQLite] | **디버그 로그는 아님.** 도메인 기록만 DB                                      |

보관 기본값 제안: 파일당 10 MB, 회전본 5개(프로세스당 최대 60 MB, 셋 합쳐 ~180 MB). 시간 기준 삭제는 두지 않는다(크기로 충분). [추론]

## 4. Ganger 에 맞춘 추천안

### 4.1 한 줄 형식

```json
{
  "t": "2026-11-20T09:12:03.412+09:00",
  "level": "info",
  "proc": "worker",
  "pid": 4121,
  "v": "0.9.0",
  "event": "runner.call",
  "msg": "called the runner",
  "runId": "run_…",
  "runnerId": "rnr_…",
  "verb": "orchestration worker-start",
  "ms": 1840,
  "exit": 0
}
```

- 고정 키: `t`(ISO 8601, ms, 로컬 오프셋 포함), `level`, `proc`(`web`·`worker`·`mcp`·`cli`·`desktop`), `pid`, `v`(Ganger 버전), `event`(점으로 나눈 고정 이름), `msg`(고정 영어 문장, **값을 끼워 넣지 않음** → grep이 됨).
- 문맥 키(있을 때만): `runId`, `ticketKey`, `runnerId`, `workspaceId`, `trackerConnectionId`, `deliveryId`, `requestId`, `orcaRunId`, `worktreeName`, `prId`.
- 오류: `err: {name, message, code, kind, stack, cause}`. `AdapterError`의 `detail.kind`(`unreachable`, `malformed-output` 등)를 `kind`로 펼친다.
- 필드 타입은 zod 스키마 하나로 정해(`LogFields`) 자유 키를 막는다. 저장소 규칙(외부 입력은 zod)과 같은 결이고, 가리기의 허용 목록이 된다. [추론]
- 로그 문구는 화면 문구가 아니므로 메시지 파일로 빼지 않고 영어 고정 문자열로 둔다(이슈 붙여 넣기·검색용). [추론, 결정 필요]

### 4.2 수준

| 수준  | 기준                                                                     | 예                                                                                                                                                                                                                                                                                        |
| ----- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| error | 코드 결함이나 지켜야 할 조건이 깨짐, 처리 안 된 예외, 프로세스가 곧 멈춤 | `uncaughtException`, 마이그레이션 실패, DB 열기 실패                                                                                                                                                                                                                                      |
| warn  | 바깥 실패라 스스로 다시 시도하지만 운영자가 손써야 할 수도 있음          | webhook 서명 실패, 러너 닿지 않음, 트래커 API 4xx/5xx, 변경 기록 정리 실패                                                                                                                                                                                                                |
| info  | 생애 주기와 **바뀜**만(상태가 그대로면 남기지 않음)                      | 프로세스 시작(버전·node·플랫폼·설정 요약)/정지, webhook 하나 처리 끝(canonical), 할당 결정(어느 러너·저장소, 이유), 런 상태 옮김, 러너 호출 중 쓰기 동작(worker-start, 답 보내기, 취소), PR 연결·상태 바뀜, 러너 Online↔Offline, worker 생존 줄(10분마다: 지켜보는 런 수, 마지막 tick ms) |
| debug | 문제 볼 때만                                                             | 모든 러너 호출(읽기 포함), tick 요약, 트래커 폴링 결과 수, SSE 연결/끊김, DB busy 재시도                                                                                                                                                                                                  |

- 기본 info. `GANGER_LOG_LEVEL=debug` 환경 변수, 그리고 Settings에 "자세한 로그 남기기"(설치 설정에 저장, 세 프로세스가 tick마다/요청마다 읽음 → 재시작 없이 바뀜). [추론]
- info 소음 상한: 런 10개를 지켜보는 보통 상태에서 시간당 수백 줄 이하를 목표로 하고, 시험으로 "변화 없는 tick은 info를 쓰지 않는다"를 묶는다. [추론]

### 4.3 상관 id 와 흐름 추적

```
Linear webhook ──(deliveryId)──▶ web: tracker_events 행
                                     │ (DB)
worker: 할당 ──(ticketKey → runId 생성)──▶ runs 행, run_state_changes
   │ ssh + orca worker-start --run <orcaRunId> --name <worktreeName> --comment "<ticketKey> <url>"
   ▼
러너(원격 Mac): Orca 워크트리 <worktreeName>, 에이전트 세션 → PR(branch)
   ▲ 지켜보기(ssh)                        │
worker: watch tick ──(runId)──────────────┘ prId/prUrl 기록 → GitHub 폴링
```

- **프로세스 안**: `AsyncLocalStorage<LogContext>` 하나를 `packages/core`(또는 새 작은 패키지)에 둔다. web은 요청 진입점(webhook 라우트, 서버 함수 미들웨어)에서 `run({requestId, deliveryId?})`, worker는 런 하나를 다루는 함수 바깥에서 `run({runId, ticketKey, runnerId})`, MCP는 도구 호출마다 `run({tool, client})`. logger가 store를 읽어 필드를 붙인다. 지금 주입하는 `WorkerLogger` 인터페이스는 유지해 시험 가짜를 그대로 쓴다. [확인: API / 추론: 배치]
- **프로세스 사이**: trace 전파는 하지 않는다. DB 행이 넘겨주는 지점이고 그 행의 id(`deliveryId`, `runId`)가 곧 상관 id다. 할당이 webhook에서 비롯됐으면 할당 info 줄에 `deliveryId`를 같이 남긴다(`tracker_events`→할당 연결 고리). [추론]
- **원격 러너**: 러너 호출 canonical 줄(`event: runner.call`)에 `runnerId`, `verb`(orca 명령 앞 두 낱말), `ms`, `exit`, `outcome`(`ok`/`unreachable`/`malformed-output`/`runner-error:<code>`), 첫 호출이면 `orcaRunId`·`worktreeName`을 남긴다. 러너 쪽 Orca 로그·워크트리와는 `worktreeName`과 `--comment`의 티켓 키로 맞춘다. stdin(에이전트 브리프·티켓 본문)과 stdout 전체는 남기지 않는다. 실패 때만 stderr 앞 500자를 가려서 남긴다. 위치는 `OrcaRunner.run()` 한 곳이다. [확인: 위치 / 추론: 필드]
- **에이전트가 한 일**은 이미 Run 상세 로그로 DB에 있다. 서버 로그에 다시 복사하지 않는다. [추론]

### 4.4 파일 위치

- `<home>/logs/web.jsonl`, `worker.jsonl`, `mcp.jsonl`(회전본 `.1`~`.5`). `cli`는 `ganger start` 감독 메시지(자식 종료·재시작)를 `ganger.jsonl`에. 데스크톱 main 프로세스 자체 오류는 `desktop.jsonl`. [추론]
- stdout/stderr: 사람이 읽는 한 줄 `HH:MM:SS WARN [worker] could not watch run runId=…`(warn 이상, 그리고 시작/정지 info). 터미널 `ganger start`는 지금처럼 보인다. `ganger mcp`는 **stdout에 아무것도 쓰지 않는다**(MCP 규격), stderr도 최소로. [확인: 규격 / 추론: 나머지]
- 기존 `ganger.log`(launchd)·`desktop-server.log`(데스크톱): 회전 대상에 넣는다. 서비스/데스크톱이 서버를 띄우기 전에 크기가 5 MB를 넘으면 `.1`로 옮긴다. [추론]
- 웹 브라우저 쪽 오류는 이번 범위에서 빼거나, 서버 함수 하나로 error만 받아 web 로그에 `proc: "browser"`로 남긴다. [추론, 결정 필요]

### 4.5 가리기

- 키 이름 기준 무조건 가림(대소문자 무시, 중첩 포함): `token`, `secret`, `password`, `authorization`, `cookie`, `signature`, `apiKey`, `privateKey`, `webhookSecret`, `deviceToken`. 값은 `"[redacted]"`. [추론]
- 오류 메시지 안 문자열: `Bearer …`, `lin_api_…`, `ghp_…`/`github_pat_…`, `-----BEGIN … KEY-----` 패턴을 지운다. [추론]
- 아예 쓰지 않는 것: webhook 본문, 티켓 본문·설명·에이전트 브리프(prompt), 에이전트 로그 줄, 환경 변수 전체, 설정 원문.
- 로컬 파일에는 `ticketKey`, `runnerId`, 러너 이름은 남긴다(운영자 자기 기기). **진단 묶음**을 만들 때 한 번 더: ssh 대상(`user@host`), 호스트명·tailnet 주소, 홈 경로(`/Users/<name>` → `~`), 티켓 키 접두어(`ACME-123` → `T1-123`처럼 묶음 안에서만 일관된 별칭), 이메일·URL의 호스트를 바꾼다. [추론]
- 가리기는 시험으로 묶는다: "알려진 비밀 모양을 넣은 오류를 로그/묶음에 써도 출력에 원문이 없다". HA 문서처럼 화면에 "공개 전에 직접 확인하세요"를 함께 둔다. [확인: HA 관행 / 추론: 시험]

### 4.6 보는 길

1. **파일 + jq**: 예) `jq -c 'select(.runId=="run_…")' ~/…/logs/*.jsonl`. 문서(README 영어)에 예시 3개. [추론]
2. **`ganger logs`**: `--proc`, `--run <id>`, `--ticket <key>`, `--level warn`, `--since 1h`, `-f`, `--json`. 회전본까지 합쳐 시각순으로 섞어 보여 준다. 사람에겐 색 입힌 한 줄, `--json`은 원본. Claude 같은 코딩 에이전트도 이걸로 읽는다. [추론]
3. **MCP 읽기 도구 `ganger_diagnose`(가칭)**: 입력 `runId` 또는 `ticketKey`(없으면 최근 warn/error). 출력은 **런 타임라인**(아래 4.7) + 그 런의 로그 줄(최대 N줄, 가린 값). ADR 0013의 MCP 범위 안에서 읽기 전용. 디버깅하는 에이전트가 파일 경로를 몰라도 된다. [추론]
4. **Settings → 진단 묶음 내려받기**(데스크톱 메뉴에도): zip 하나에 `about.json`(Ganger·Node·OS·아키텍처·실행 방식·프로세스 생존·DB 크기·WAL 크기·마이그레이션 버전), `settings.json`(비밀·주소 제외, 켜진 것/개수만), `runners.json`(상태·마지막 닿은 시각, 이름 별칭), `runs-recent.json`(최근 50개 런의 상태·결과·시각·`startError` 종류), `webhooks.json`(마지막 받은 시각·서명 실패 수·처리 안 된 수), `timeline-<runId>.json`(선택한 런), `logs/`(최근 7일 warn 이상 + 최근 2,000줄 info, 가림), `process-report.json`(`getReport()`에서 `environmentVariables`·네트워크 빼고). 이름에 `BUG-`식 짧은 식별자를 넣어 운영자가 이슈에 붙이면 맞출 수 있게(Tailscale 방식). [확인: 참고 제품 / 추론: 구성]
5. 웹 안 로그 뷰어(목록+상세)는 처음엔 만들지 않는다. Run 상세에 "이 런의 서버 로그" 탭을 붙이는 것은 4.7 다음 단계. [추론]

### 4.7 기존 DB 표 다시 쓰기

- **런 타임라인**(새 표 없음): `runs`(할당·시작·끝 시각, `startError`, `unreachableSince`), `run_state_changes`, `tracker_events`(그 티켓의 배달), `mcp_actions`(그 런), `notification_events`, `run_questions`/`run_permission_waits`/`run_cancel_requests`를 `at` 순으로 합친 읽기 함수 하나. `packages/db`에 두고 MCP 도구·진단 묶음·나중에 Run 상세가 같이 쓴다. [추론]
- `change_events`는 하루 뒤 지우고 내용이 없어(GLOSSARY) 진단에 쓸모가 적다. 쓰지 않는다. [확인: 정의 / 추론]
- `tracker_webhook_receipts`(브랜치 0130)는 진단 묶음 `webhooks.json`의 원천이 된다. [추론]
- 새 DB 표는 만들지 않는다. 필요해지면(예: 런 하나의 "왜 이 러너를 골랐나") 그 사실을 `runs` 열이나 도메인 표로 올리고 로그로 대신하지 않는다. [추론]

### 4.8 오류 처리 바닥

- 세 프로세스 모두 `uncaughtException`·`unhandledRejection`에서 error 줄을 **동기로** 쓴 뒤 종료(감독자가 재시작). 노드 플래그 `--report-on-fatalerror --report-directory=<home>/logs/reports --report-exclude-env`를 붙여 OOM 같은 경우도 남긴다(보고서는 최근 3개만). [확인: 플래그 / 추론: 적용]
- 외부 오류 추적(Sentry)은 넣지 않는다. 넣는다면 나중에 opt-in 설정 하나로. [추론]

### 4.9 작업 순서 제안(티켓 단위)

1. 로그 모듈(형식·수준·가리기·파일 회전·AsyncLocalStorage) + 시험, 기존 `consoleWebhookLogger`·`WorkerLogger`·raw console 4곳 옮기기.
2. canonical 줄 셋(webhook, 러너 호출, 런 상태 옮김) + 생존 줄 + 시작/정지 줄.
3. `ganger logs` CLI.
4. 런 타임라인 읽기 함수 + MCP 읽기 도구.
5. 진단 묶음(Settings·데스크톱 메뉴) + 익명화 시험.
6. 기존 stdout 파일(`ganger.log`, `desktop-server.log`) 크기 제한.

## 5. 결정이 필요한 질문

| #   | 질문                                   | 선택지                                                                                                   | 추천                                                                                        |
| --- | -------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Q1  | 로그를 누가 파일에 쓰나                | (a) 각 프로세스가 자기 파일 (b) stdout만 쓰고 감독자(`ganger start`/launchd/데스크톱)가 파일로 (c) 둘 다 | **(a)**: 실행 방식마다 갈리지 않고 MCP는 stdout을 못 씀. stdout은 warn 이상 사람용으로 남김 |
| Q2  | 파일을 프로세스별로 나누나             | (a) 프로세스별 (b) 하나에 모두                                                                           | **(a)**: 회전 경쟁 없음. `ganger logs`가 합쳐 보여 줌                                       |
| Q3  | 라이브러리                             | (a) 자체 모듈 (b) pino + pino-roll (c) OTel                                                              | **(a)**: 번들·worker thread 부담 없음, 줄 수 적음                                           |
| Q4  | 기본 수준과 바꾸는 법                  | (a) info + 환경 변수 (b) info + 환경 변수 + Settings 토글(재시작 없이) (c) warn                          | **(b)**                                                                                     |
| Q5  | info에 무엇을 남기나                   | (a) 바뀜만 + 10분 생존 줄 (b) tick마다 요약 (c) 실패만(지금)                                             | **(a)**                                                                                     |
| Q6  | `event` 이름 키를 따로 두나            | (a) `event`(점 이름) + 고정 `msg` (b) `msg`만                                                            | **(a)**: grep·jq·MCP 필터가 안정적                                                          |
| Q7  | 디버그 문맥을 DB에 넣나                | (a) 아니오, 파일만 (b) 로그 표 추가 (c) warn 이상만 DB                                                   | **(a)**: 단일 쓰기 잠금·롤백·DB 장애 때 공백. 도메인 사실은 기존 표로                       |
| Q8  | 보관 크기                              | (a) 10 MB × 5 (b) 50 MB × 3 (c) 설정으로                                                                 | **(a)**, 환경 변수로만 바꿀 수 있게                                                         |
| Q9  | 러너 호출을 어디까지 남기나            | (a) 쓰기 동작 info + 모든 호출 debug (b) 모두 info (c) 실패만                                            | **(a)**, stdin·stdout 본문은 남기지 않음                                                    |
| Q10 | 로컬 파일에 티켓 키·러너 이름을 남기나 | (a) 남기고 진단 묶음에서 익명화 (b) 로컬부터 해시                                                        | **(a)**: 운영자가 자기 로그를 읽을 수 있어야 함                                             |
| Q11 | 진단 묶음 익명화를 기본으로 하나       | (a) 기본 켬, 끌 수 있음 (b) 기본 끔 (c) 항상 켬                                                          | **(a)**                                                                                     |
| Q12 | MCP 읽기 도구를 넣나                   | (a) 런/티켓 단위 타임라인+로그 (b) 로그 tail만 (c) 넣지 않음                                             | **(a)**, 읽기 전용, ADR 0013 범위 확인                                                      |
| Q13 | 웹 안 로그 뷰어                        | (a) 지금은 없음, 진단 묶음·CLI만 (b) Run 상세에 "서버 로그" 탭 (c) 별도 화면                             | **(a)** 후 (b)                                                                              |
| Q14 | 브라우저 오류 수집                     | (a) 안 함 (b) error만 서버 함수로 받아 web 로그                                                          | **(b)**, 작음                                                                               |
| Q15 | 외부 오류 추적                         | (a) 없음 (b) opt-in Sentry DSN 설정                                                                      | **(a)**                                                                                     |
| Q16 | 기존 `ganger.log`·`desktop-server.log` | (a) 시작 전 크기 넘으면 옮김 (b) 그대로 (c) 없애고 자체 파일만                                           | **(a)**                                                                                     |
| Q17 | 로그 문구 언어                         | (a) 영어 고정 문자열(메시지 파일 아님) (b) 메시지 파일로 i18n                                            | **(a)**: 화면 문구가 아니고 이슈 검색에 씀                                                  |
| Q18 | 새 낱말                                | "서버 로그", "진단 묶음", "런 타임라인" 등                                                               | GLOSSARY에 먼저 올리고 "변경 로그"와 헷갈리지 않게 `_Avoid_` 정리                           |
| Q19 | 되돌리기 어려운가                      | 파일 형식 키 이름은 `ganger logs`·MCP·사용자 jq가 의존                                                   | ADR 하나로 고정 키와 수준 기준을 적음                                                       |

## 6. 출처

- Stripe, "Fast and flexible observability with canonical log lines": https://stripe.com/blog/canonical-log-lines
- Honeycomb, "Structured Events Are the Basis of Observability": https://www.honeycomb.io/blog/structured-events-basis-observability
- Charity Majors, "Is it time to version observability? (Signs point to yes)": https://charity.wtf/2024/08/07/is-it-time-to-version-observability-signs-point-to-yes/
- Node.js, Asynchronous context tracking: https://nodejs.org/api/async_context.html
- Node.js, Diagnostics Channel: https://nodejs.org/api/diagnostics_channel.html (최신판을 읽음. Node 24의 채널 목록은 따로 확인 필요)
- Node.js, Diagnostic report: https://nodejs.org/api/report.html
- pino transports: https://github.com/pinojs/pino/blob/main/docs/transports.md
- pino bundling: https://github.com/pinojs/pino/blob/main/docs/bundling.md
- pino redaction: https://github.com/pinojs/pino/blob/main/docs/redaction.md
- pino-roll: https://github.com/mcollina/pino-roll
- OpenTelemetry JavaScript 상태: https://opentelemetry.io/docs/languages/js/
- OpenTelemetry Logs 개념: https://opentelemetry.io/docs/concepts/signals/logs/
- Sentry self-hosted 요구 사항: https://develop.sentry.dev/self-hosted/
- Home Assistant Diagnostics: https://www.home-assistant.io/integrations/diagnostics/
- Tailscale bugreport: https://tailscale.com/kb/1227/bug-report
- SQLite Write-Ahead Logging: https://www.sqlite.org/wal.html
- newsyslog.conf(5): https://keith.github.io/xcode-man-pages/newsyslog.conf.5.html
- journald.conf(5): https://www.freedesktop.org/software/systemd/man/latest/journald.conf.html
- MCP Transports(stdio): https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- 저장소: `apps/cli/src/start.ts`, `apps/cli/src/service.ts`, `apps/desktop/src/core/local-server.ts`, `apps/desktop/src/core/open-log.ts`, `apps/web/src/webhooks/receive.ts`, `apps/worker/src/watch.ts`, `apps/worker/src/context.ts`, `packages/db/src/database.ts`, `packages/db/src/schema.ts`, `packages/runner-orca/src/orca-runner.ts`, `GLOSSARY.md`, `docs/adr/0019-query-cache-and-change-events.md`
