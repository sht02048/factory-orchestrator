# 0018 e2e 시험 빠르게 하기

이 조사를 바탕으로 운영자가 2026-11-20 권장 순서의 1단계(CI 를 잡 여럿과 shard 로 나누기)를 정했다. 그 작업은 티켓 [0143](../tickets/0143-ci-e2e-shards.md)에 있다. 이 문서는 조사 당시 그대로 둔다.

## 질문

CI `check` 잡이 10~13분 걸리고 그 대부분이 `pnpm test` 의 e2e 다. 어디에 시간이 드는지 재고, 무엇을 바꾸면 얼마나 줄어드는지, 흔들림(0121·0131·0135·0136·0137·0142)을 늘리지 않는 길이 무엇인지 정한다.

표시: [확인] 은 코드·CI 로그·공식 문서로 확인한 것(출처를 붙인다), [추론] 은 잰 값에서 미루어 본 것이다.

## 잰 방법

- 2026-11-20 의 성공한 CI 실행 6개(run 44703524620, 44718473819, 44721656875, 44722642149, 44724377206, 44727574452)의 로그를 `gh run view --log` 로 받아, vitest 기본 리포터가 찍은 파일 줄(`✓ e2e src/x.test.ts (N tests) Xms`)과 그 아래 시험 줄의 시간을 모았다. 단계 시간은 `gh run view --json jobs` 의 단계 시작·끝 시각이다.
- 로컬에서 e2e 를 돌리지 않았다(공유 맥 부하).
- 파일 시간은 여섯 실행의 중앙값이다. 같은 러너에서 3개 파일이 동시에 도는 조건의 값이라, 단독 실행 시간보다 길다.

## 지금 CI 의 시간

[확인] `check` 는 한 잡에서 모든 단계를 차례로 돈다(`.github/workflows/ci.yml`). 러너는 `ubuntu-latest`(로그상 이미지 ubuntu-26.04)이고, 공개 저장소의 표준 러너는 4 CPU·16 GB 다(GitHub 문서 "GitHub-hosted runners reference").

| 단계                                    | 시간(run 44727574452 / 44721656875) |
| --------------------------------------- | ----------------------------------: |
| 체크아웃·pnpm·node·install              |                         14초 / 13초 |
| Typecheck                               |                         12초 / 20초 |
| Lint·색·길이·format                     |                           6초 / 9초 |
| **Test(`pnpm test`)**                   |            **7분 58초 / 11분 31초** |
| Build                                   |                          7초 / 10초 |
| smoke:web·smoke:cli·bundle·smoke:bundle |                         25초 / 27초 |
| 잡 전체                                 |                 9분 2초 / 12분 50초 |

- [확인] Test 단계의 vitest `Duration` 은 여섯 실행에서 411~690초(중앙값 약 498초)다. 같은 코드도 실행마다 1.7배까지 흔들린다. Test 를 뺀 나머지는 합쳐 1분 남짓이다.
- [확인] Build 뒤 smoke 단계는 e2e 와 일을 겹쳐 하지 않는다. e2e 는 Vite 개발 서버를, smoke:web 은 빌드 결과물을 띄운다(`e2e/src/web-server.ts`, `scripts/smoke-web-prod.ts`). 합쳐 30초 남짓이라 줄일 몫이 작다.

### 프로젝트별 시간(파일 시간의 합, 워커-초)

[확인] run 44727574452 기준: e2e 28개 파일 1179초, demo 4개 80초(`demo/src/dev.test.ts` 하나가 79초), desktop 23개 41초, web 66개 19초, 나머지 프로젝트 모두 합쳐 30초 미만. 여섯 실행에서 e2e 는 1029~1718초다.

[확인] 시각으로 보면 단위 시험은 시작 뒤 약 37초 안에 끝나고(desktop `screens.test.ts` 24초가 가장 김), 그 뒤 약 7분은 e2e 만 돈다(11:27:35 → 11:34:39).

[확인] vitest 5.1.0 의 기본 `maxWorkers` 는 `run` 모드에서 `availableParallelism() - 1` 이다(`node_modules/vitest` 의 `getDefaultMaxWorkers`). 4 CPU 러너에서는 3이다. 저장소 설정에 `maxWorkers`·`pool`·`fileParallelism`·`isolate` 지정은 없다(`vitest.config.ts`, `e2e/vitest.config.ts`).

[추론] e2e 합 1241초를 워커 3개에 시간 긴 순서로 나누면 415초가 나온다. 실제 e2e 구간 약 424초와 거의 같다. 즉 지금 Test 단계는 "e2e 워커-초 합 ÷ 3" 으로 설명된다. 줄이려면 합을 줄이거나 기계를 늘려야 한다.

### 느린 파일 15개

`준비` 는 파일 시간에서 시험 시간 합을 뺀 값(`beforeAll` 의 서버·브라우저 기동과 데우기, `afterAll`)이다. 데우기가 없는 파일은 첫 시험이 그 몫을 떠안아 `가장 긴 시험` 이 커진다.

|   # | 파일                       | 시험 수 | 중앙값 | 최소~최대 | 준비 | 가장 긴 시험 |
| --: | -------------------------- | ------: | -----: | --------: | ---: | -----------: |
|   1 | `settings.test.ts`         |      33 |  133초 |   108~191 | 16초 |         17초 |
|   2 | `home.test.ts`             |      24 |  114초 |    91~154 | 17초 |         13초 |
|   3 | `dashboard-query.test.ts`  |      20 |  106초 |    93~136 | 22초 |         18초 |
|   4 | `query-screens.test.ts`    |      19 |  100초 |    83~132 | 20초 |         14초 |
|   5 | `runner-setup.test.ts`     |      15 |   76초 |    57~103 |  3초 |         25초 |
|   6 | `settings-query.test.ts`   |      12 |   75초 |     61~97 | 18초 |         15초 |
|   7 | `query-cache.test.ts`      |      15 |   60초 |     51~81 | 18초 |          9초 |
|   8 | `desktop-updates.test.ts`  |      10 |   53초 |     48~71 | 16초 |         12초 |
|   9 | `runs-query.test.ts`       |       8 |   50초 |     38~68 | 15초 |          7초 |
|  10 | `runs.test.ts`             |       7 |   46초 |     37~68 | 13초 |         18초 |
|  11 | `runners.test.ts`          |       9 |   45초 |     36~61 |  2초 |         18초 |
|  12 | `stats.test.ts`            |      12 |   42초 |     32~62 |  2초 |         19초 |
|  13 | `navigation.test.ts`       |       8 |   42초 |     35~55 | 19초 |          5초 |
|  14 | `tickets.test.ts`          |       8 |   40초 |     32~51 |  2초 |         17초 |
|  15 | `operator-actions.test.ts` |       4 |   30초 |     24~45 |  2초 |         24초 |

(e2e 밖에서는 `demo/src/dev.test.ts` 80초, `apps/desktop/src/renderer/screens.test.ts` 20초가 길다.)

## 원인

### 1. 파일마다 Vite 개발 서버와 Chrome 을 새로 띄운다

- [확인] e2e 시험 파일 27개가 `beforeAll` 에서 `startWebServer()` 로 Vite 개발 서버를 하나씩 띄운다(`web-server.test.ts` 는 2개). 서버는 vitest 워커 프로세스 안에서 `createServer()` 로 돈다(`e2e/src/web-server.ts`).
- [확인] 파일마다 `cacheDir` 를 새 임시 폴더로 준다(예: `settings.test.ts` 의 `join(dir, "vite-cache")`). [추론] 그래서 파일마다 의존성 사전 묶기(optimizeDeps)와 TanStack Start·StyleX 변환을 처음부터 다시 한다.
- [확인] 파일마다 다른 Vite 플러그인(가짜 어댑터로 `resolveId` 바꾸기)과 `process.env`(`DATABASE_PATH` 등)를 쓴다. 그래서 파일끼리 서버를 그대로 나눠 쓸 수 없다.
- [확인] 25개 파일이 `chromium.launch({ channel: "chrome" })` 로 Chrome 을 파일마다 띄운다. 브라우저를 내려받지 않고 러너에 깔린 Chrome 을 쓴다(README "Google Chrome installed on the machine"). 그래서 Playwright 브라우저 캐시는 해당이 없다.
- [확인] 파일 첫 페이지 열기(데우기 또는 첫 시험)가 12~25초 걸린다. 데우기가 있는 파일은 `준비` 가 13~22초, 없는 파일은 첫 시험이 12~14초다(stats 13.2초, runners 13.3초, tickets 14.2초, run-detail 12.0초). 이후 시험은 대개 2~4초다.
- [추론] 파일당 첫 열기 비용을 약 15초로 잡으면 28개 파일에서 약 400 워커-초, e2e 합의 약 1/3 이다. 가장 큰 단일 원인이다.
- [확인] 0121 은 개발 서버에서 Runners 첫 방문이 모듈 요청 174개(다른 화면 24~59개)라 부하에서 느리고, 프로덕션 빌드에서는 묶여서 그렇지 않다고 적었다.

### 2. 4 CPU 에 서버 3개와 Chrome 3개

- [추론] 워커 3개가 각각 Vite 서버(변환은 같은 프로세스)와 Chrome(여러 프로세스)을 돌려 4 CPU 를 넘게 쓴다. 같은 코드의 Test 시간이 411~690초로 흔들리는 것, 파일 시간 최소·최대 차이가 1.5배 안팎인 것과 맞는다.
- [확인] 흔들림 티켓의 원인이 거의 모두 부하다. 0121(8개 동시 실행에서 모듈 변환이 밀림), 0131(첫 시험이 개발 서버 첫 변환을 떠안아 5초 초과, 16회 중 8회), 0135(부하로 hydration 이 `networkidle` 뒤로 밀림), 0136(자식 프로세스 시험이 부하에서 5초 초과). 그 파일만 돌리면 통과한다는 기록이 반복된다.
- [추론] 그래서 한 기계의 동시 실행 수를 늘리는 길은 빨라지기보다 흔들림을 늘린다. 공유 맥에서 작업자 4~5개가 각자 `pnpm test`(기본 워커 = 코어-1)를 돌리면 같은 일이 더 심하게 일어난다.

### 3. 고정 기다림과 `networkidle`

- [확인] `waitForTimeout` 고정 기다림이 있다. 큰 것: `dashboard-query` 의 `SETTLE_MS` 1.5초 ×9곳과 `CONTROL_POLL_MS*2` 4초, 실제 시간으로 카드 시간 글자가 바뀌기를 최대 30초 기다리는 시험(`TIME_TEXT_TICK_MS` 15초 틱), `query-cache` 의 `PRELOAD_FRESH_MS + SETTLE_MS` 5.5초 ×2, `query-screens`·`settings-query` 의 `settle()` 0.7초(각 12·17곳)와 3·4초, `desktop-updates` 8초.
- [추론] 합치면 약 90 워커-초(e2e 합의 약 7%)다. 상당수는 "이 시간 동안 아무 일도 없어야 한다" 를 보는 부정 확인이라 그냥 지울 수 없다.
- [확인] `networkidle` 을 41곳에서 쓴다. 매번 요청이 500ms 동안 없기를 기다린다. Playwright 문서는 `networkidle` 을 "DISCOURAGED … Don't use this method for testing" 으로, `waitForTimeout` 을 "Tests that wait for time are inherently flaky" 로 적는다(Playwright `Page` API 문서).
- [확인] 30초 폴링·5분 GC 같은 긴 시간은 이미 `page.clock.runFor`/`fastForward` 로 건너뛴다(`dashboard-query`·`query-screens`·`runs-query`·`settings-query`). 실제로 30초를 기다리는 곳은 없다. `worker-wake` 의 60초 폴링 간격은 깨우기가 폴링보다 빠른지 보는 값이라 기다리지 않는다.

### 4. DB

- [확인] 파일마다 임시 폴더에 SQLite 를 열고 `migrate()` 를 한 번 돌린다(`beforeAll`). 시험마다 다시 만들지 않는다. [추론] 파일당 1초 미만으로 보여 줄일 몫이 작다.

## 선택지

시간 추정은 위의 모형(Test ≈ 단위 약 40초 + e2e 합 ÷ 워커 수, 잡마다 준비 약 20초)으로 한다.

### A. CI 를 잡 여럿으로 나누고 e2e 를 shard 로 나눈다

- [확인] vitest `--shard=i/n` 은 테스트 파일 단위로 나누고, 각 기계가 `--reporter=blob` 을 남기면 `--merge-reports` 로 합친다. 공식 문서에 GitHub Actions matrix 예가 있다(Vitest "Improving Performance"). 높은 CPU 기계에서도 Vite 서버 하나가 병목이 될 수 있어 shard 가 도움이 된다고 적는다.
- [확인] vitest 5.1.0 의 shard 는 파일 경로의 sha1 순으로 정렬해 개수로 자른다. 시간을 보지 않는다(`BaseSequencer.shard`).
- [추론] 지금 파일 시간으로 계산하면 e2e 만 hash shard 로 나눌 때 shard 별 시간(워커 3):
  - 3개: 121·144·158초. 4개: 73·110·126·136초.
  - 시간으로 고르게 나누면(사용자 정의 sequencer) 4개 104~130초. 첫 파일 `settings.test.ts` 130초가 바닥이다.
  - 워커 2로 4개(부하를 줄이는 쪽): 고르게 나누면 약 157초.
- [추론] 나머지(typecheck·lint·검사·단위 시험·build·smoke)를 한 잡으로 두면 약 20초 + 30초 + 40초 + 35초 ≈ 2~2.5분이다. `demo/src/dev.test.ts`(80초)는 브라우저 시험이라 e2e shard 쪽에 넣는다.
- 기대 효과: 잡 전체 9~13분 → 약 3~4분. [추론]
- 공수: 반나절. matrix 잡, blob 리포트 업로드·합치기(선택), 실패 스크린숏 업로드를 shard 별로 옮긴다.
- 주의할 점:
  - [확인] develop ruleset 이 필수 상태 검사로 `check` 하나를 요구한다(`gh api repos/.../rulesets`). matrix 잡 이름은 `e2e (1/4)` 처럼 바뀌므로, 모든 잡을 `needs` 로 기다리는 `check` 잡을 남겨야 한다. Markdown 만 바뀐 변경을 건너뛰는 지금 규칙도 그 잡에서 지켜야 한다.
  - [확인] `ci.yml` 은 `workflow_call` 로도 불린다. 부르는 쪽이 잡 이름에 기대는지 확인해야 한다.
  - [추론] 러너 분(minutes)은 잡마다 준비 20초씩 늘지만 공개 저장소 표준 러너는 무료다.
- 흔들림: shard 마다 워커 수가 같으면 파일당 부하는 지금과 같다. 워커를 2로 줄이면 부하가 줄어 흔들림이 줄 것으로 본다. [추론]
- 맞음: 높다. 코드 변경 없이 워크플로만 바꾼다.

### B. Vite 의존성 캐시를 미리 만들어 나눠 쓴다

- 방법: `globalSetup` 에서 웹 앱의 의존성 사전 묶기를 한 번 하고, 파일마다 그 캐시를 자기 `cacheDir` 로 복사해 쓴다. 같은 폴더를 여러 서버가 동시에 쓰지 않게 한다.
- 기대 효과: 파일당 첫 열기 12~25초 중 의존성 묶기 몫만큼. 몫을 모른다. 3~8초로 잡으면 85~220 워커-초, 지금 구조에서 30~70초, shard 뒤에는 shard 당 10~20초. [추론]
- 공수: 1일. 먼저 `beforeAll` 의 `createServer`·`chromium.launch`·첫 페이지 시간을 나눠 재야 한다.
- 위험: 캐시가 잘못 맞으면 개발 서버가 다시 묶으며 페이지를 다시 읽게 해(optimizeDeps 재실행) 오히려 흔들릴 수 있다. [추론]
- 맞음: 보통. 재 보고 몫이 클 때만 한다.

### C. Chrome 을 한 번 띄워 파일끼리 나눠 쓴다

- [확인] Playwright `browserType.launchServer()` 로 띄운 브라우저에 `browserType.connect(wsEndpoint)` 로 붙을 수 있다(Playwright `BrowserType` API 문서). `globalSetup` 이 띄우고 `provide`/`inject` 로 주소를 넘긴다.
- 기대 효과: 파일당 Chrome 기동 1초 안팎 × 28 ≈ 30 워커-초, 지금 구조에서 약 10초. [추론]
- 위험: 파일들이 한 Chrome 을 나눠 써 한 파일의 멈춤이 다른 파일로 번질 수 있다. `--host-resolver-rules` 처럼 파일마다 다른 실행 인자를 쓰는 파일(`settings.test.ts`)은 따로 띄워야 한다.
- 맞음: 낮다. 얻는 것이 작다.

### D. 고정 기다림을 신호나 가짜 시계로 바꾼다

- 대상: 실제 시간으로 15초 틱을 기다리는 `dashboard-query` '다시 읽지 않아도 카드의 지난 시간이 흐른다', `desktop-updates` 8초, `query-cache` 5.5초 ×2. 이미 같은 파일들이 `page.clock` 을 쓰고 있어 같은 방식으로 바꿀 수 있다.
- 기대 효과: 합 약 90 워커-초 중 절반 정도. shard 뒤에는 그 파일이 든 shard 에서 10~20초. [추론]
- 위험: 부정 확인("그동안 다시 읽지 않는다")의 뜻이 바뀌지 않게 해야 한다. `networkidle` 을 화면 신호로 바꾸면 0135 같은 흔들림도 줄지만 고칠 곳이 41곳이다.
- 맞음: 보통. 흔들림 티켓이 나올 때 그 파일부터 바꾸는 편이 낫다.

### E. 개발 서버 대신 빌드 결과물로 e2e 를 돌린다

- 방법: 가짜 어댑터를 빌드 시점 `resolveId` 대신 실행 시점 설정으로 고르게 바꾸고, 웹을 한 번 빌드해 모든 파일이 그 결과물을 띄운다.
- 기대 효과: 파일당 첫 열기 비용 대부분(약 400 워커-초)과 개발 서버 모듈 사슬로 생긴 흔들림(0121)이 사라진다. [추론]
- 공수: 여러 날. 파일마다 다른 플러그인·`process.env` 를 실행 시점 설정으로 옮겨야 하고, 개발 서버에서만 보는 시험(`dev-styles.test.ts`, HMR)은 남겨야 한다. 제품에 시험용 어댑터 선택 경로가 생긴다.
- 맞음: 장기 후보. A 뒤에도 느리거나 흔들리면 검토한다.

### 하지 않을 것

- 워커 수 늘리기(`maxWorkers`↑): 4 CPU 가 이미 넘친다. 흔들림 티켓의 공통 원인이다. [추론]
- `isolate: false`: [확인] 공식 문서는 부수효과가 없고 상태를 정리하는 시험에만 권한다. e2e 는 워커 프로세스 안에서 개발 서버를 돌리고 `process.env` 를 바꾼다. 파일끼리 새어 나간다. [추론]
- 파일 안 `test.concurrent`: [확인] 파일들이 하나의 `page`·DB·서버 호출 기록(`serverCalls`)을 시험끼리 차례로 쓴다. 동시 실행하면 서로 기록을 섞는다.
- `--changed`(관련 시험만): [확인] e2e 파일은 웹 화면 코드를 import 하지 않고 Vite 서버로 읽는다(import 하는 것은 메시지 JSON·`@ganger/db`·fixture). [추론] vitest 모듈 그래프에 화면 코드가 없어 화면을 바꿔도 e2e 를 건너뛴다. 머지 게이트로 쓸 수 없다.
- 큰 러너: [확인] GitHub Team·Enterprise Cloud 조직용이다(GitHub 러너 문서). 이 저장소는 개인 계정 소유라 쓸 수 없다.

## 권장 순서

| 단계 | 할 일                                                                                                                                                                                   | 잡 전체(추정)                 |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 0    | 지금                                                                                                                                                                                    | 9~13분(Test 7~11.5분)         |
| 1    | CI 를 `static`(typecheck·lint·검사·단위 시험·build·smoke) 잡과 e2e·demo 브라우저 시험 shard 4개로 나누고, 모두를 기다리는 `check` 잡을 둔다. 브라우저 shard 는 워커 2(`--maxWorkers=2`) | 3~4분 [추론]                  |
| 2    | 첫 열기 시간을 나눠 잰다(`createServer`·`chromium.launch`·첫 페이지). 의존성 묶기 몫이 크면 B                                                                                           | shard 당 −10~20초 [추론]      |
| 3    | hash shard 가 기울면(가장 긴 shard 가 가장 짧은 shard 의 1.5배 넘음) 시간으로 나누는 sequencer 를 쓴다                                                                                  | 가장 긴 shard ≈ 2분 대 [추론] |
| 4    | 흔들림 티켓이 나오는 파일부터 D(가짜 시계·화면 신호)                                                                                                                                    | shard 당 −10초 안팎 [추론]    |
| 5    | 그래도 느리거나 흔들리면 E 를 따로 조사                                                                                                                                                 | —                             |

로컬: [추론] 공유 맥에서는 전체 `pnpm test` 대신 바꾼 파일만 돌리고 워커를 줄인다(`--maxWorkers=2` 또는 `VITEST_MAX_WORKERS`). 전체 e2e 는 CI 에 맡긴다(0135·0137 이 이미 그렇게 했다).

## 확인할 것

- 1단계 뒤 10회 이상: 잡별 시간(`gh run view --json jobs`), shard 별 가장 긴 파일, `check` 잡 전체 시간. 3~4분이 아니면 shard 수·워커 수를 다시 고른다.
- 흔들림: 단계 전후 같은 기간의 "첫 시도 실패, 다시 돌려 통과" 횟수(0136 이 쓴 `gh run list` 방법). 워커 2가 흔들림을 줄이는지 본다.
- 파일 시간 흩어짐: 같은 파일의 최소·최대 차이가 지금 1.5배에서 줄면 부하가 준 것이다.
- 2단계 측정값: 파일당 서버 기동·Chrome 기동·첫 페이지 시간. 이 값으로 B·E 를 할지 정한다.

## 출처

- 저장소: `.github/workflows/ci.yml`, `vitest.config.ts`, `e2e/vitest.config.ts`, `e2e/src/web-server.ts`, `e2e/src/*.test.ts`, `apps/web/vite.config.ts`, `scripts/smoke-web-prod.ts`, README, 티켓 0121·0131·0135·0136·0137·0142.
- vitest 5.1.0 소스(`node_modules/vitest/dist`): 기본 `maxWorkers`, `BaseSequencer.shard`·`sort`.
- CI 로그: 위 여섯 run(2026-11-20).
- Vitest, "Improving Performance": https://vitest.dev/guide/improving-performance
- GitHub, "GitHub-hosted runners reference": https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- Playwright, `Page` API(`waitForLoadState`, `waitForTimeout`): https://playwright.dev/docs/api/class-page
- Playwright, `BrowserType` API(`launchServer`, `connect`): https://playwright.dev/docs/api/class-browsertype
