---
status: done
blocked_by: []
---

# 0121 흔들리는 e2e 두 개 고치기

## 목표

CI 와 로컬 부하에서 가끔 실패하는 e2e 두 개의 원인을 찾아 고친다. 제한 시간만 늘리지 않고, 시험이 기다리는 신호를 바로잡는다.

- `e2e/src/nav-shortcuts.test.ts` '데스크톱 메뉴가 보낸 화면으로 입력칸에 포커스가 있어도 …'
- `e2e/src/desktop-updates.test.ts` '다른 토스트가 와도 밀려나지 않고 그 위에 다른 토스트가 쌓인다'

## 배경

2026-11-19 PR #157(0116) CI 가 두 시험으로 연달아 실패했다. 같은 맥에서 develop(4823ef2)도 같은 비율로 흔들렸다. 토스트 시험은 8개 동시 실행에서 5/16, nav-shortcuts 는 CI 에서 Runners 포커스가 `expect.poll` 기본 1초 안에 닿지 않았다. 화면별 포커스 시간 중앙값은 Runners 153ms, 다른 화면 8~53ms 였다.

## 원인

### nav-shortcuts: Runners 첫 방문의 모듈 사슬

- 메뉴로 옮기면 `useDesktopNavigation`이 `navigate()`가 끝난 뒤(라우트 코드와 로더를 다 읽은 뒤) 레일 링크에 포커스를 둔다. URL 과 `aria-current`는 그보다 먼저 바뀐다.
- 시험은 `waitForURL` 직후부터 `expect.poll` 기본 제한 1초로 포커스를 기다렸다. 실제로 기다려야 할 것은 URL 이 아니라 이동이 끝나는 것이다.
- 화면별로 재 보니(시드 데이터, Vite 개발 서버) Runners 첫 방문만 느리다. 서버 함수는 8ms 이고, 나머지는 브라우저가 Runners 라우트 코드를 처음 읽는 시간이다. Runners 라우트는 `runner-setup`, `settings-screen`(RunnerForm), `updates-panel`, `push-check` 등을 끌어와 개발 서버에서 모듈 요청이 174개다(다른 화면 24~59개). import 사슬이라 차례로 받아야 한다. 다시 들어가면 5~10ms 다.

한 번 잰 값, 메뉴 신호부터 포커스까지:

| 첫 방문(ms)  | Dashboard | Tickets | Runs | Runners | Stats | Settings |
| ------------ | --------: | ------: | ---: | ------: | ----: | -------: |
| 보통         |        33 |      23 |   44 |     159 |    55 |       49 |
| CPU 6배 감속 |       224 |     173 |  153 |     284 |   136 |      184 |

- 시험을 8개 동시에 돌리면 개발 서버의 모듈 변환이 밀려 Runners 가 1초를 넘는다. 실패 스크린숏은 Runners 링크가 `aria-current`인데 화면은 아직 Runs 다. CDP CPU 감속은 브라우저만 느리게 해서 1초를 넘기지 못했다.
- 제품 쪽은 고치지 않았다. 프로덕션 빌드에서는 이 모듈들이 묶음으로 나와 Runners 도 다른 화면과 같다(0117: 첫 방문 96ms). 포커스를 이동이 끝난 뒤 두는 동작도 맞다. 새 화면이 그려지기 전에 포커스를 옮기면 화면이 바뀌는 동안 포커스 위치가 어긋날 수 있다. Runners 라우트가 Settings 화면 모듈 전체를 끌어오는 것은 나중에 RunnerForm 을 떼어 줄일 수 있지만, 0119 가 같은 화면을 고치는 중이라 이 티켓에서 하지 않는다.

### desktop-updates: 등장 애니메이션 중간값

- 고정 토스트는 나타날 때 `rise` 키프레임으로 6px 아래에서 올라온다(`motion.durationToast`, ease-out). 시험은 `waitFor()`(보이기만 기다림) 직후 위치를 재서, 부하로 늦으면 애니메이션 끝자락의 1~2px 을 잡았다. 그 뒤 다른 토스트가 온 다음 잰 위치는 다 올라온 자리라 차이가 1.1px, 2.1px 로 나왔다.
- 고정 토스트는 다른 토스트가 와도 실제로 움직이지 않는다. 제품 버그가 아니다.

## 고친 것

- nav-shortcuts: `waitForURL` 대신 `navigation-timing.ts`의 `waitForRouterIdle`(라우터가 그 경로를 읽고 쉰 뒤 두 프레임)을 기다린 다음 포커스를 본다. 이동이 끝났다는 명시적 신호다.
- desktop-updates: 상자를 재기 전에 그 요소와 자식의 애니메이션(`getAnimations({ subtree: true })`)이 끝나기를 기다린다. 줄인 움직임 대신 기본 움직임 그대로 끝난 상태를 잰다.

## 완료 조건

- [x] 고치기 전 시험으로 같은 맥에서 실패를 재현한다(8개 동시 실행 16회): nav-shortcuts 8/16, 토스트 4/16 실패.
- [x] 고친 시험이 8개 동시 실행 16회에서 0 실패다: nav-shortcuts 0/16, 토스트 0/16.
- [x] 고친 시험이 전체 시험(`pnpm run test`) 3회에서 0 실패다. 3회 중 1회는 이 티켓과 상관없는 `apps/desktop/src/core/local-server.test.ts` 'ServerWatch > 짧은 시간에 거듭 끝나면 …'이 5초 제한을 넘겨 실패했다. 실제 프로세스를 띄우고 죽이는 시험이라 부하에 흔들린다. 별도 티켓 후보로 남긴다.
