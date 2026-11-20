# 서버 로그는 프로세스마다 JSON Lines 파일에 고정 키로 쓴다

web·worker는 `console.warn("[worker] …", 필드)`로 경고만 남겼고, 그 출력은 실행 방식에 따라 터미널, launchd의 `ganger.log`, systemd journald, 데스크톱의 `desktop-server.log`로 흩어졌다. 회전도 없었다. 런이 왜 멈췄는지 보려면 어디에 무엇이 있는지부터 알아야 했다(조사 [research 0017](../research/0017-logging.md)). 2026-11-20 운영자가 조사 추천대로 L1~L12를 정했다(스펙 [0004](../spec/0004-server-logs.md) 12절).

## 결정

- **web·worker·`ganger mcp`·`ganger start`가 각자 `<home>/logs/{web,worker,mcp,cli}.jsonl`에 직접 쓴다.** 한 줄이 JSON 객체 하나다. 실행 방식과 상관없이 같다. 콘솔에는 사람이 읽는 warn 이상만 쓰고, `ganger mcp`는 stdout에 쓰지 않는다.
- **고정 키는 `t`, `level`, `proc`, `pid`, `v`, `event`, `msg`이고 이 순서로 먼저 온다.** `t`는 밀리초와 로컬 오프셋이 있는 ISO 8601이다. `event`는 점으로 나눈 고정 이름(`webhook.received`)이고 `msg`는 `event`마다 정해진 영어 문장이다. 값을 `msg`에 끼워 넣지 않는다. 그 밖의 키는 `packages/log/src/fields.ts`의 목록만 쓰고, 값은 문자열·숫자·참거짓·null만 쓴다. 오류는 `err` 객체 하나다.
- **수준은 `error`·`warn`·`info`·`debug` 넷이고 기본은 info다.** error는 코드 결함과 처리 안 된 예외, warn은 스스로 다시 시도하지만 운영자가 손써야 할 수 있는 바깥 실패, info는 바뀐 것만(시작·정지, webhook 처리, 할당 결정, 런 상태 옮김, 러너 쓰기 호출, 러너 Online↔Offline, 10분 생존 줄), debug는 모든 러너 호출과 tick 요약이다.
- **라이브러리 없이 `@ganger/log` 한 패키지가 `node:fs` 동기 쓰기와 `AsyncLocalStorage`로 한다.** 파일은 10MB에서 `.1`로 밀고 회전본을 5개까지 둔다. 디버그 로그는 DB에 넣지 않는다.

## 되돌리기 어려운 이유

`ganger logs`(0133)와 읽기 전용 MCP 도구가 `event`·`level`·`runId` 같은 키로 거르고, 운영자가 쓴 `jq` 명령과 이슈에 붙인 로그도 키 이름에 기댄다. 키 이름이나 수준 뜻을 바꾸면 이미 쌓인 파일과 사람들의 명령이 함께 깨진다. 그래서 고정 키와 수준 기준을 여기 묶는다. 새 `event`와 새 문맥 키를 더하는 것은 되돌리기 쉽다. 있던 것의 이름을 바꾸거나 뜻을 바꾸는 것은 이 ADR을 고친다.

## 고려한 대안

- **pino + pino-roll.** 빠르고 redaction이 있지만 transport가 worker thread에서 돌아 배포물 한 파일로 묶을 수 없고 web(vite/srvx)·worker·cli 세 빌드에 따로 설정이 필요하다. 시작이 비동기라 일찍 끝나면 줄을 잃는다. 로그는 분당 수십 줄이라 속도 이득이 의미 없다(L8).
- **OpenTelemetry.** JS의 logs 신호가 아직 development이고, 수집기·백엔드를 사용자가 따로 운영해야 한다. 셀프호스팅 한 대에 비해 크다.
- **DB 로그 표.** SQLite WAL은 쓰는 쪽이 하나라 로그 한 줄마다 런 상태 트랜잭션과 잠금을 다툰다. 실패한 트랜잭션 안에서 쓴 로그는 함께 롤백되고, DB가 잠기거나 깨졌을 때가 로그가 가장 필요한 때인데 그때 쓸 수 없다(L4). 도메인 사실은 기존 표가 있고, 그것을 시각순으로 합친 런 타임라인으로 본다.
- **stdout만 쓰고 감독자(`ganger start`·launchd·systemd·데스크톱)가 파일로 받는다.** 실행 방식마다 위치·회전이 갈리고(launchd는 회전 없음, systemd는 journald), `ganger mcp`는 stdout을 쓸 수 없다. 프로세스를 넘는 한 줄 단위도 감독자가 보장하지 못한다(지금 `ganger start`는 조각 단위로 넘겼다).
- **Sentry(자체 호스팅 또는 SaaS).** 자체 호스팅은 최소 4코어·RAM 16GB를 요구하고, SaaS는 운영자 데이터를 제3자에게 보낸다. 사용자가 많은 서비스용이다(L7).

## 결과

- `@ganger/log`를 web·worker·cli·desktop·db·runner-orca가 쓴다. db는 커밋 뒤(`onCommit`)에 info 줄을 써서 롤백된 변경을 남기지 않는다.
- 기존 `logger.warn` 문장은 `msg`로 그대로 두고 `event` 이름만 붙였다. 콘솔 모양은 `HH:MM:SS WARN [worker] <msg> 키=값`이 되었다.
- launchd `ganger.log`와 데스크톱 `desktop-server.log`도 같은 한도로 시작 전에 회전한다. srvx가 요청마다 stdout에 쓰는 줄은 끄는 옵션이 없어 남는다(스펙 0004 8절).
- 수준은 줄마다 다시 읽으므로 Settings 스위치(0134)가 재시작 없이 debug를 켤 수 있다.
