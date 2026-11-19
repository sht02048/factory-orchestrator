---
status: done
blocked_by: [0119]
---

# 0122 원격에서 화면 이동 빠르게

## 목표

서버와 다른 기기(데스크톱 앱, tailnet 너머)에서 레일로 화면을 옮길 때 기다리는 시간을 줄이고, 기다리는 동안 눌렸다는 표시를 둔다. 빨라진 대신 오래된 티켓 상태를 보일 수 있는 최대 시간을 정한다.

## 배경

운영자 환경(2026-11-19): 서버는 다른 맥, 운영자는 노트북의 데스크톱 앱으로 tailnet 너머에서 쓴다. 노트북에서 서버로 잰 ping 18~216ms(평균 91ms), 페이지 첫 응답 Dashboard 0.10s, Tickets 0.55s, Runs 0.15s, Runners 0.09s, Stats 0.07s, Settings 1.64s(0.1.0, 0117 전). 0117 은 같은 기기에서 재서 왕복 지연이 빠져 있었다. 0117 '후속 후보' 세 개가 이 티켓이다.

## 할 일

1. 원격 조건으로 재기: 왕복 지연을 넣어 바로 누름·다시 들어가기·올린 뒤 누름을 전·후 표로 남긴다.
2. 트래커 결과 담아 두기: Tickets 로더의 트래커 티켓 목록과 Settings 의 트래커 프로젝트·상태·라벨을 서버에 짧게 담아 두고(stale-while-revalidate), 지우는 경로를 둔다. 최대 오래됨 시간을 티켓·ADR 에 적는다.
3. 왕복 줄이기: 첫 클라이언트 이동 때 루트 `beforeLoad`가 온보딩 완료를 다시 묻는 왕복을 없앤다.
4. 누른 표시: 로더가 150ms 안에 끝나지 않으면 진행 표시를 둔다. 깜박임 없이, reduced motion 존중.

## 고칠 파일

- `packages/app/src/tracker-reads.ts`(새), `packages/app/src/tickets/*`, `packages/app/src/settings/load.ts`·`actions.ts`
- `packages/db`(표 `tracker_read_generations`, 마이그레이션)
- `apps/web/src/server/*`, `apps/web/src/settings/use-settings-actions.ts`(Linear에서 다시 읽기), `apps/web/src/webhooks/receive.ts`, `apps/web/src/routes/__root.tsx`, `apps/web/src/routes/_app/tickets.tsx`, `apps/web/src/tickets/tickets-screen.tsx`, `apps/web/messages/ko/tickets.json`
- 셸: `apps/web/src/shell/*`, `apps/web/messages/ko/shell.json`
- `apps/worker/src/auto-assign.ts`, `after-run.ts`
- `packages/ui`(`AppFrame` `pending`), `DESIGN.md`, `/ds`
- `e2e/src/navigation*.ts`, `e2e/src/measure-*.ts`
- ADR 0019(새)

## 재는 법

- 운영 서버나 프로덕션 빌드: `node e2e/src/measure-navigation.ts --url <웹 주소> --rtt 0,100,200 [--repeat 3]`. `--rtt`는 Chrome 네트워크 에뮬레이션(CDP `Network.emulateNetworkConditions`)으로 요청마다 왕복 지연을 넣는다. 0117 의 표에 왕복 열이 더해진다.
- 느린 트래커까지 재현: `MEASURE_RTT=0,100,200 MEASURE_TRACKER_DELAY=500 pnpm exec vitest run -c e2e/vitest.measure.config.ts`. e2e 의 브라우저 시험과 같은 시드·개발 서버에서 트래커 읽기마다 500ms 를 늦춘다. 시작 전에 레일을 한 바퀴 돌아 화면 코드를 받고 서버에 트래커 읽기를 담아 둔다.
- 개발 서버라 화면 코드가 묶이지 않은 모듈 여럿으로 와서, 왕복 지연을 넣으면 처음 여는 화면은 코드 받기에 왕복이 여러 번 든다(프로덕션 빌드는 화면마다 한 묶음).

## 잰 결과

개발 서버, 트래커 읽기마다 500ms, 3번 중앙값(ms), 고치기 전(develop 1e287f6) → 고친 뒤. 왕복은 Chrome 이 요청마다 더한 지연이다.

| 왕복 | 경우                      |   Dashboard |   Tickets |      Runs |   Runners |     Stats |  Settings |
| ---: | ------------------------- | ----------: | --------: | --------: | --------: | --------: | --------: |
|    0 | 첫 방문, 바로 누름        |    111 → 97 |  601 → 99 | 102 → 100 | 100 → 104 |   97 → 95 | 585 → 102 |
|    0 | 다시 들어가기             |     81 → 80 |   84 → 66 |   65 → 83 |   82 → 82 |   68 → 83 |   83 → 99 |
|    0 | 첫 방문, 300ms 올려 둔 뒤 |     84 → 85 |  313 → 59 |   75 → 72 |   82 → 80 |   63 → 83 |  296 → 75 |
|  100 | 첫 방문, 바로 누름        |   676 → 574 | 605 → 419 | 300 → 300 | 537 → 519 | 400 → 415 | 602 → 316 |
|  100 | 다시 들어가기             |     68 → 77 |   81 → 81 |   70 → 79 |   82 → 81 |   65 → 83 |   90 → 84 |
|  100 | 첫 방문, 300ms 올려 둔 뒤 |   215 → 212 | 296 → 113 |   76 → 82 | 229 → 242 | 116 → 118 |  309 → 64 |
|  200 | 첫 방문, 바로 누름        | 1281 → 1081 | 716 → 734 | 500 → 496 | 916 → 917 | 717 → 716 | 600 → 518 |
|  200 | 다시 들어가기             |     78 → 78 |   70 → 93 |   77 → 94 |   87 → 76 |   84 → 80 |   73 → 80 |
|  200 | 첫 방문, 300ms 올려 둔 뒤 |   914 → 733 | 429 → 411 | 228 → 220 | 628 → 836 | 417 → 413 | 297 → 228 |

- 트래커를 기다리던 Tickets·Settings 의 바로 누른 첫 방문이 왕복 0 에서 601 → 99, 585 → 102, 왕복 100 에서 605 → 419, 602 → 316 이 됐다. 서버 함수 시간은 트래커 500ms 에서 왕복 한 번(약 100~200ms)으로 줄었다(서버에 담아 둔 읽기).
- 첫 클라이언트 이동(Dashboard, 바로 누름)에서 `getOnboardingComplete`·`getTimeZone`·`getTitleBarHidden`이 빠져 서버 함수가 `getHomePage` 하나다. 왕복 200 에서 1281 → 1081.
- 왕복 200 의 Tickets 첫 방문(716 → 734)은 줄지 않았다. 개발 서버는 화면 코드를 묶지 않은 모듈 여럿으로 보내 코드 받기에 왕복이 여러 번 들고, 이것이 트래커 500ms 보다 길어 로더와 겹친다. 프로덕션 빌드는 화면마다 한 묶음이라 코드 받기 왕복이 줄어든다. 운영 서버에서 `node e2e/src/measure-navigation.ts --url <주소> --rtt 0,100,200`으로 다시 잴 수 있다.
- 다시 들어가기는 전·후 모두 지난 화면을 바로 그리고(60~100ms) 뒤에서 새로 읽는다. 고친 뒤에는 그 뒤 읽기도 트래커를 기다리지 않는다(Tickets 서버 함수 500 → 90~190ms).
- 올린 뒤 누름은 미리 읽기가 트래커를 기다리지 않아 Tickets·Settings 가 왕복 100 에서 296 → 113, 309 → 64 다.
- Dashboard 첫 방문의 `requestRunLog`는 재기 시작 화면(없는 런 상세)의 로그 요청이라 이동과 상관없다.

## 바꾼 것

- **트래커 읽기 담아 두기(ADR 0019).** 웹 서버가 연결별로 트래커 읽기를 담아 둔다. 30초 안이면 그대로, 30초~5분이면 지난 값을 바로 주고 뒤에서 새로 읽고, 5분이 지나면 기다린다. 실패는 담아 두지 않는다. 새로 담을 때 세대가 지났거나 5분이 넘은 항목을 지워 쪽 커서가 바뀌어도 쌓이지 않는다. 연결별 세대 수(`tracker_read_generations`)가 오르면 담아 둔 값을 쓰지 않는다. 세대를 올리는 곳: 트래커 webhook 기록, worker 폴링 보정이 지난번보다 새로 바뀐 티켓을 읽음(겹치는 구간에서 같은 티켓을 다시 읽어도 올리지 않는다), worker 가 런 시작 때 티켓 상태를 바꿈, 할당, 바로 할당 라벨 만들기, Mapping 저장, 트래커 연결 저장·확인, Tickets 머리의 "트래커에서 다시 읽기", Settings 프로젝트 상세·라벨 고르기의 "Linear에서 다시 읽기"(0119 버튼, 지금까지는 화면만 다시 읽어 담아 둔 값을 받았을 것이라 세대를 올리게 했다).
- **오래된 티켓 상태를 보일 수 있는 최대 시간: 5분.** webhook 이 있으면 webhook 이 도착할 때까지.
- **루트 왕복.** 서버 렌더 때 루트 `beforeLoad`가 안 온보딩 완료 값을 루트 로더 데이터로 넘기고, 브라우저가 하이드레이션 뒤 그 값을 기억한다. 첫 클라이언트 이동부터 `getOnboardingComplete`를 부르지 않아 화면 이동 한 번에 서버 함수가 하나다. 셸·루트 로더는 0117 대로 다시 읽지 않는다.
- **진행 표시.** 주소가 바뀌는 이동(화면·Workspace)에서 라우터가 150ms 넘게 다음 화면을 읽으면 본문 맨 위에 2px 노란 진행 줄이 지나가고 본문에 `aria-busy`, 화면 읽기용 상태 문장 "화면을 여는 중이에요"를 둔다. 한 번 켜면 300ms 는 두어 깜박이지 않는다. `prefers-reduced-motion`이면 멈춘 줄이다. 같은 화면을 다시 읽는 `router.invalidate()`(Run 상세 폴링, 저장 뒤, 다시 읽기)에는 켜지 않는다. 라우터 `pendingComponent`는 쓰지 않았다. 쓰면 늦은 이동 동안 이전 화면이 지워지고 빈 틀이 보여, 이전 화면을 둔 채 진행 줄만 보이는 편이 덜 깜박인다. 레일은 누르는 즉시 새 화면 링크에 `aria-current`가 옮겨 가므로(0113) 어느 링크를 눌렀는지는 레일이 이미 보인다.

- **트래커에서 다시 읽기(Tickets 머리).** 세대를 올리고 화면이 새 값을 다 읽을 때까지(`invalidate({ sync: true })`) 기다린다. 다 읽은 뒤 읽지 못한 트래커 프로젝트가 있으면 버튼 아래에 실패 문장, 없으면 "다시 읽었어요"를 5초 둔다. 버튼은 `packages/ui` `Button`의 새 `busy`(두 라벨을 겹쳐 폭을 그대로 둔다)를 쓴다. Settings 의 "Linear에서 다시 읽기"도 같은 서버 함수와 `sync`를 쓴다.

## 완료 조건

- [x] 원격 지연 측정 스크립트와 전·후 표
- [x] 캐시 시험(`packages/app/src/tracker-reads.test.ts`): 새것 동안 다시 부르지 않음, 30초 뒤 지난 값 + 뒤에서 새로 읽기, 5분 지난 값은 기다림, 세대가 오르면 기다림, 읽는 동안 오르면 결과를 쓰지 않음, 겹친 읽기 한 번, 실패는 담지 않음
- [x] 무효화 시험(`apps/web/src/tickets/tracker-cache.test.ts`, worker `auto-assign.test.ts`·`after-run.test.ts`, `packages/db/src/tracker-reads.test.ts`): webhook·할당·라벨 만들기·다시 읽기 뒤 새 값, worker 폴링·상태 바꾸기가 세대를 올림
- [x] 브라우저 시험(`e2e/src/navigation.test.ts`): 바로 누른 Tickets 첫 방문이 느린 트래커를 기다리지 않음, 첫 클라이언트 이동의 서버 함수가 하나, 빠른 이동과 다시 읽기에는 진행 줄이 나타나지 않음, 늦은 이동에는 진행 줄·`aria-busy`·상태 문장이 보이고 끝나면 걷힘
- [x] 진행 표시 시점 시험(`apps/web/src/shell/navigation-pending.test.ts`)
- [x] 스크린숏: 느린 이동 중 진행 표시, 400px
