---
status: todo
blocked_by: []
---

# web이 DB에 쓴 직후 worker 깨우기

## 목표

운영자가 화면에서 한 일(할당, 취소, 질문 답변, 권한 거절, 러너 확인, 로그 꼬리)과 트래커 webhook으로 들어온 이벤트를 worker가 다음 폴링(최대 10초)을 기다리지 않고 바로 처리한다.

## 배경

web과 worker는 SQLite 파일 하나로만 주고받는다(ADR 0002). web이 DB에 요청을 쓰면 worker는 다음 바퀴에 그것을 읽는다. 바퀴는 앞 바퀴가 끝나고 10초 쉰 뒤 돈다(`apps/worker/src/boot.ts`의 `POLL_INTERVAL_MS`, `apps/worker/src/worker.ts`의 `startWorker`). 그래서 운영자 행동이 처리되기까지 최대 10초가 걸린다.

러너 쪽 감지(에이전트가 묻거나 권한을 기다리는 것, 완료 보고)는 ssh로 물어야 알 수 있어 폴링이 계속 맡는다. 러너가 서버로 콜백하는 방식은 ADR 0002가 버렸다. 이 티켓은 web → worker 방향만 빠르게 한다.

## 운영자 결정 (2026-11-18, 그릴링)

- **기준은 DB, 신호는 힌트.** web은 DB 쓰기가 끝난 뒤 worker에 내용 없는 "깨어나" 신호만 보낸다. worker는 신호에서 아무것도 꺼내지 않고 지금처럼 DB를 읽는다. 신호를 잃어도(worker 재시작 중 등) 다음 폴링이 처리하므로 정확성은 바뀌지 않고 반응 속도만 바뀐다.
- **범위.** 운영자 행동과 webhook 이벤트만 빨라진다. 러너 쪽 감지는 그대로다.
- **폴링 유지.** 10초 폴링 간격은 바꾸지 않는다.
- **전체 바퀴.** 깨우면 지금 바퀴 전체(러너 확인 → 런 감시 → 취소 → 자동 할당 → 대기열 → 뒤처리 → 로그 꼬리)를 돈다. 신호 종류에 따라 일부 단계만 도는 짧은 경로는 두지 않는다. 같은 바퀴의 단계 순서에 기대는 규칙(끝난 런의 capacity를 같은 바퀴의 대기열이 쓰는 것 등)을 다시 맞춰야 하기 때문이다.
- **250ms 창.** 신호를 받으면 250ms 기다렸다가 돈다. 그사이 온 신호는 한 바퀴로 묶는다. 창은 첫 신호에서 시작하고 뒤 신호가 늘리지 않는다. 신호가 끊이지 않아도 바퀴가 밀리지 않게 하려는 것이다. 쉬는 중에 온 신호와 바퀴 도중에 온 신호에 같은 규칙을 쓴다.
- **최소 1초 쉼(독립 리뷰 반영).** 신호로 시작하는 바퀴는 앞 바퀴가 끝나고 적어도 1초 뒤에 돈다. 바퀴는 돌 때마다 진행 중인 런마다 러너에 ssh로 묻는다(`apps/worker/src/watch.ts`). 활발한 트래커 팀이나 일괄 수정으로 서명을 통과한 webhook이 끊이지 않으면, 쉼이 없을 때 바퀴가 쉬지 않고 이어져 러너에 ssh가 몰린다. 운영자 행동은 최대 10초에서 최대 약 1초(+250ms 창)로 빨라지는 것으로 충분하다. 지금은 10초 동안 쌓인 라벨 이벤트를 티켓마다 가장 최근 라벨 상태로 판단해(`apps/worker/src/auto-assign.ts`의 `latestLabels`), 라벨을 붙였다 곧 떼면 할당이 일어나지 않는다. 신호를 붙이면 250ms보다 늦게 뗀 경우 런이 생긴다. 지금도 두 이벤트가 바퀴 경계에 걸치면 생기는 일이라 받아들인다.
- **신호를 보내는 쓰기.** worker가 읽어 처리할 것이 생기는 쓰기다. 설정 변경(러너, 트래커 연결, GitHub 토큰, Mapping, Workspace, 트래커 프로젝트, Auto-assign Label)도 들어간다. 하나씩 넣지 않고 한 곳에서 붙인다(아래 「web」). DB를 쓰지 않는 POST(연결 확인)와 worker가 읽지 않는 주소 설정 저장도 신호를 보내게 되지만, 250ms 창과 최소 1초 쉼에 묶여 바퀴가 조금 더 자주 도는 것뿐이라 받아들인다. 새 server function을 더할 때 신호를 빠뜨리지 않는 쪽을 골랐다.
- **성공한 요청만 신호를 보낸다(독립 리뷰 반영).** webhook 경로는 webhook 공개 주소로도 받고 Origin을 보지 않는다(`apps/web/src/server/request-guard.ts`). 서명이 틀린 요청도 응답 전까지는 처리되므로, 응답과 상관없이 신호를 보내면 인터넷의 누구나 바퀴를 연달아 돌려 러너에 ssh를 보내게 할 수 있다. 바퀴는 돌 때마다 진행 중인 런마다 러너에 묻는다(`apps/worker/src/watch.ts`). 그래서 응답이 2xx인 요청만 신호를 보낸다. 서명을 통과한 webhook과 바인드 주소에 닿는 클라이언트의 요청만 남는다. 바인드 주소에 닿는 클라이언트는 지금도 할당·취소를 할 수 있어 새로 열리는 것은 없다.
- **통로: `start`의 IPC 중계.** `start`가 web과 worker를 IPC 통로와 함께 띄우고, web이 보낸 신호를 worker로 넘긴다. CLI `start`, 서비스(launchd·systemd), 데스크톱 앱이 모두 `start`를 거친다. web과 worker를 `start` 없이 따로 띄우면 신호가 없고 지금처럼 폴링으로만 돈다. 유닉스 소켓(`<home>/worker.sock`)은 따로 띄워도 돌지만 남은 소켓 파일과 파일 권한을 관리해야 해서 고르지 않았다. 로컬 HTTP 포트는 포트와 Host 검사가 하나 더 늘고, DB 파일 감시(`fs.watch`)는 macOS에서 믿기 어렵고 worker 자신의 쓰기에도 반응해서 고르지 않았다.
- **메시지.** `{ type: "wake" }` 하나다. `start`와 worker가 경계에서 zod로 검증하고, 다른 메시지는 조용히 버린다. 신호마다 로그는 남기지 않는다.
- **`start`가 띄웠을 때만 보낸다(독립 리뷰 반영).** IPC 통로는 `start` 말고도 생긴다(vitest의 fork 풀, pm2 같은 프로세스 관리자). 그 부모에게 신호를 보내지 않게, `start`가 자식 환경에 `GANGER_WORKER_WAKE=ipc`를 넣고 web과 worker는 이 값이 있을 때만 신호를 주고받는다.
- **`pnpm dev`.** demo에서도 동작한다. 제품 코드에 개발용 갈래를 넣지 않고 demo의 vite 플러그인이 web 쪽 신호 모듈을 갈아 끼운다.
- **문서.** ADR 0002에 「기준은 DB, 신호는 잃어도 되는 힌트, 폴링은 유지」 단락을 덧붙이고 새 ADR은 만들지 않는다. 신호를 떼어 내도 동작이 그대로라 되돌리기 어려운 결정이 아니다. ADR 단락은 구현과 같은 PR에 넣는다.
- **저장소.** Redis 같은 외부 브로커는 쓰지 않는다. 운영자 한 명이 자기 기계에 설치해 쓰는 제품(ADR 0005)에서 운영자가 따로 설치하고 지켜야 할 상시 서비스를 늘리지 않는다.

## 범위

### worker

- `startWorker`가 돌려주는 `RunningWorker`에 `wake()`를 더한다.
- 루프의 `setTimeout` 대기를 "폴링 기한(바퀴 끝 + 폴링 간격)과 신호 기한 중 이른 쪽"까지 기다리도록 바꾼다. 신호 기한은 max(첫 `wake()` + 250ms, 바퀴 끝 + 1초)다. 뒤 `wake()`는 기한을 늘리지 않는다. 두 값은 이름 붙은 상수로 둔다.
- 신호를 잃지 않게 `dirty` 표시를 둔다. 첫 `wake()` 시각은 `dirty`가 거짓에서 참이 될 때만 적는다. 바퀴를 **시작할 때** `dirty`를 지우고, 바퀴가 끝난 뒤 남아 있으면 신호 기한(이미 지났으면 바로)에 한 바퀴를 더 돈다. 끝날 때 지우면 바퀴 도중에 온 신호를 잃는다. 잠들기 전에도 `dirty`를 먼저 봐서, 바퀴가 끝나고 잠들기 직전에 온 신호를 놓치지 않는다.
- 바퀴가 실패해도 루프가 이어지게 지금의 `try`/`catch`와 "tick failed" 로그를 그대로 둔다.

  ```ts
  while (!stopped) {
    dirty = false;
    try {
      await worker.tick();
    } catch (error) {
      logger.warn("tick failed", { error });
    }
    // 폴링 기한과 max(첫 wake + 250ms, 바퀴 끝 + 1초) 중 이른 쪽에 깬다. 자는 중에 온 wake도 같다.
    await sleepUntil(pollIntervalMs);
  }
  ```

- 바퀴가 겹치지 않는 지금 규칙(`createWorker`의 `running ??=`)은 그대로 둔다.
- `stop()`은 기다리는 중이어도 바로 멈춘다.
- 진입점(`apps/worker/src/main.ts`)이 `process.on("message")`로 받은 값을 zod로 검증해 `wake()`를 부른다. `GANGER_WORKER_WAKE=ipc`가 없거나 IPC 통로가 없으면 듣지 않는다.
- `apps/worker`에는 아직 zod가 없다. web·cli와 같은 고정 버전(지금 4.6.7)으로 더한다.

### `start`

- `apps/cli/src/start.ts`의 `spawnChild`가 web과 worker를 `stdio`의 네 번째 자리에 `"ipc"`를 두고 띄운다(`onOutput`이 있을 때와 없을 때 모두). 자식 환경에 `GANGER_WORKER_WAKE=ipc`를 넣는다.
- web 자식의 `message`를 zod로 검증해 `{ type: "wake" }`만 worker 자식에 `send`한다. worker가 이미 끝났으면(`child.connected`가 거짓) 보내지 않는다.
- `send`에는 콜백을 넘겨 실패를 거기서 버린다. 콜백이 없으면 실패가 자식의 `'error'` 이벤트로 오는데, `spawnChild`는 그 이벤트를 띄우기 실패로 읽는다(`child.once("error", …)`).
- `srvx`도 스스로 `process.send?.({ error: "no-entry" })`를 보낼 수 있다(`srvx/dist/cli.mjs:34`). 검증에서 걸러진다.

### web

- 신호 모듈 하나(예: `apps/web/src/server/worker-wake.ts`)가 신호를 보낸다. `GANGER_WORKER_WAKE=ipc`가 있고 `process.connected`일 때만 `process.send({ type: "wake" }, () => undefined)`를 부른다. 콜백을 넘기지 않으면 통로가 닫혔을 때(`start`가 먼저 끝난 경우) 실패가 `process`의 `'error'`로 와서 잡히지 않은 예외가 되고, `srvx`가 프로세스를 끝낸다(`srvx/dist/cli.mjs`의 `uncaughtException` 처리). 그 밖에는 아무것도 하지 않고, 실패해도 요청 처리에 영향을 주지 않는다.
- 부르는 곳은 서버 진입(`apps/web/src/server.ts`) 한 곳이다. 이 진입은 이미 모든 요청(화면, server function, webhook)을 감싸 Host·Origin 검사를 한다. Host·Origin 검사를 통과한 POST 요청에 대해 `handler.fetch`가 2xx 응답을 돌려준 뒤 신호를 보낸다.
  - TanStack Start의 전역 server function 미들웨어(`createStart`의 `functionMiddleware`)는 server function만 감싸고 webhook 서버 라우트는 감싸지 않아 고르지 않았다.
  - 값을 바꾸는 server function은 모두 POST이고, 읽기만 하는 것은 `createServerFn({ method: "GET" })`이다. webhook도 POST다.
  - SQLite 쓰기는 동기로 돌아서, 응답이 나올 때 쓰기는 이미 커밋돼 있다. 비동기 server function(트래커 연결 저장은 원격 확인 뒤 쓴다)도 응답 전에 끝난다.
- 2xx가 아닌 응답(서명이 틀린 webhook, 잘못된 입력, 서버 오류)에는 신호를 보내지 않는다(위 「성공한 요청만 신호를 보낸다」).

### `pnpm dev`

- `demo/src/runtime.ts`가 `globalThis.__factoryDev.runtime`에 worker의 `wake`를 연다.
- `demo/src/plugins.ts`가 web의 신호 모듈을 demo판으로 갈아 끼운다(어댑터를 갈아 끼우는 방식과 같다). demo판은 `globalThis.__factoryDev.runtime.wake()`를 부른다.
- 서버 배포물 검사(`scripts/bundle-check.ts`)와 제품 경계 시험(`demo/src/boundary.test.ts`)이 그대로 통과한다.

### 문서

- ADR 0002에 위 「기준은 DB, 신호는 힌트」 단락을 덧붙인다.
- README(영어) 개발 절의 worker 설명에 "`start`로 띄우면 web의 변경에 바로 반응하고, 따로 띄우면 폴링 간격으로만 반응한다"를 더한다.

## 범위 밖(후속)

- 러너 → 운영자 방향(에이전트가 묻거나 권한을 기다리는 것, 완료 보고의 감지). 러너 콜백이 필요하다.
- 폴링 간격 바꾸기.
- 신호 종류에 따른 짧은 경로.
- web과 worker를 따로 띄울 때의 신호(유닉스 소켓).

## 완료 조건

`[unit]`은 CI의 `pnpm test`, `[smoke]`는 로컬 `pnpm --filter @ganger/desktop smoke`다.

- [ ] 앞 바퀴가 끝나고 1초가 지난 뒤 쉬는 중에 `wake()`를 부르면 폴링 간격보다 먼저(250ms 뒤) 바퀴가 돈다. `[unit]`
- [ ] `wake()`가 끊임없이 와도 바퀴 사이에 적어도 1초 쉰다. `[unit]`
- [ ] 바퀴 도중에 `wake()`를 여러 번 불러도 추가 바퀴는 정확히 하나다. `[unit]`
- [ ] `wake()`를 250ms보다 짧은 간격으로 계속 불러도 첫 `wake()` 뒤 250ms에 바퀴가 돈다(뒤 신호가 바퀴를 미루지 않는다). `[unit]`
- [ ] `wake()`를 부르지 않으면 폴링 간격대로 돈다. 바퀴가 실패해도 루프는 이어진다. `[unit]`
- [ ] 기다리는 중에 `stop()`을 부르면 바로 멈춘다. `[unit]`
- [ ] `start`에서 web 자식이 보낸 `{ type: "wake" }`가 worker 자식에 닿고, 다른 메시지는 넘기지 않는다. worker가 끝난 뒤 온 신호는 `start`를 멈추거나 띄우기 실패로 기록하지 않는다. 가짜 자식 스크립트로 시험한다. `[unit]`
- [ ] web 서버 진입은 2xx로 응답한 POST 요청(server function, webhook)에만 신호를 보내고, GET 요청, Host·Origin 검사에서 거절한 요청, 서명이 틀린 webhook, 2xx가 아닌 응답에는 보내지 않는다. `GANGER_WORKER_WAKE=ipc`가 없거나 통로가 닫혀 있으면 아무것도 보내지 않고 예외도 내지 않는다. `[unit]`
- [ ] web을 거친 할당이 폴링을 기다리지 않는다. e2e에서 vite 플러그인으로 web의 신호 모듈을 같은 프로세스 worker의 `wake()`로 갈아 끼우고(demo와 같은 방식), 폴링 간격을 60초로 둔 worker의 첫 바퀴가 끝나기를 기다린 뒤 web의 server function으로 할당한 런이 몇 초 안에 시작되고, 갈아 끼운 `wake()`가 불렸다. 첫 바퀴 전에 할당하면 신호 없이도 시작돼 시험이 아무것도 확인하지 못한다. 지금 e2e 얇은 경로 시험은 DB에 직접 할당해(`e2e/src/thin-path.test.ts`의 `assignRun`) 이 경로를 지나지 않는다. `start`의 중계는 위 `start` 시험이 맡는다. `[unit]`
- [ ] `ELECTRON_RUN_AS_NODE=1`인 Electron 실행 파일이 같은 방식으로 띄운 자식과 IPC 메시지를 주고받는다. `[smoke]`
- [ ] ADR 0002 단락과 README 문장이 들어간다.

## 남은 위험

- **`srvx`의 IPC 분기.** `srvx`는 IPC 통로가 있으면 다른 분기를 탄다(`srvx/dist/cli.mjs:325`). 이 분기는 `.env`·`.env.production` 파일을 읽지 않고 시작할 때 버전 줄을 찍지 않는다. `start`는 환경 값을 직접 넘기고 배포물의 web 폴더에는 `.env`가 없어 동작에는 영향이 없어 보인다. 로그에서 버전 줄 하나가 빠진다.
- **데스크톱 앱의 IPC.** 데스크톱 앱에서는 `start`와 그 자식이 모두 `ELECTRON_RUN_AS_NODE=1`인 Electron 실행 파일로 돈다. 이 모드에서 Node의 IPC가 그대로 도는지는 아직 확인하지 않았다(완료 조건의 `[smoke]`).
- **스트리밍 응답.** 응답 본문을 스트리밍하는 핸들러는 `handler.fetch`가 본문을 다 쓰기 전에 돌아올 수 있다. 지금 값을 바꾸는 server function과 webhook은 스트리밍하지 않는다. 그래도 커밋 전에 신호가 가면 그 일은 다음 폴링에서 처리된다(늦어질 뿐 틀리지 않는다).
- **IPC 통로와 프로세스 수명.** 자식 쪽 IPC 통로는 `'message'`·`'disconnect'`를 듣는 동안 Node 이벤트 루프를 붙잡는다. 듣는 쪽인 worker가 여기에 든다(보내기만 하는 web은 들지 않는다). worker 진입점은 `stop()` 뒤 `process.exit`으로 끝나 문제가 없어 보이지만, 시험에서 끝나는지 확인한다.
