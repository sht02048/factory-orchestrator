---
status: doing
blocked_by: []
---

# 0138 데스크톱 앱 창 닫기를 누르면 검은 화면

## 목표

운영자 보고(2026-11-20, 출시판 0.1.0): "앱 닫기 버튼 누를 때 안 닫히고 그냥 검은 화면이 된다." 닫기 버튼(빨간 신호등)이나 ⌘W 를 누르면 창이 실제로 사라지고, Dock·메뉴 막대에서 다시 열 수 있어야 한다.

## 원인

`apps/desktop/src/main/controller.ts` 본 창의 `close` 처리는 종료 중이 아니면 `event.preventDefault()` 뒤 `window.hide()`를 부른다. 앱은 닫아도 메뉴 막대·Dock 에 남는 설계다. macOS 에서 전체 화면 창(자기 Space)을 `hide()` 하면 창은 숨지만 그 전체 화면 공간이 검게 남는다. Electron 에 알려진 동작이다.

- electron/electron#20263 "Black screen on window close in fullscreen mode": 같은 close 처리(`preventDefault()` + `hide()`)로 같은 증상을 보고했다. 고쳐지지 않고 지원 기간 만료로 닫혔고, 뒤에도 재현된다는 댓글이 있다. 같은 핸들러에서 `setFullScreen(false)` 바로 뒤 `hide()`를 부르면 전환이 비동기라 숨기기가 무시된다는 댓글도 있다.
- electron/electron#39572 "Fullscreen windows turn black when hidden": macOS, `status/confirmed`.
- Electron 문서: macOS 의 전체 화면 전환은 비동기이고, 끝나면 `leave-full-screen` 이벤트가 온다.

출시판 0.1.0(`v0.1.0`, 465d99d)과 develop(9ea69ed)의 `close` 처리와 `showWindow()`는 같은 코드다. 출시판과 develop 사이에 데스크톱 앱의 다른 곳은 바뀌었지만(업데이트, 창 모양 등) 닫기 처리는 그대로다.

## 고친 것

- `apps/desktop/src/main/window-close.ts` `hideWindow`: 전체 화면이 아니면 바로 숨긴다. 전체 화면이면 `leave-full-screen`을 기다리는 리스너를 먼저 걸고 `setFullScreen(false)`를 불러, 전체 화면에서 나온 뒤 숨긴다.
- `controller.ts` 의 본 창 `close` 처리가 `window.hide()` 대신 `hideWindow(window)`를 부른다. 알림 설정 창은 닫으면 실제로 닫히므로(`closed`에서 참조를 지움) 그대로 둔다.
- 다시 열면 일반 창으로 연다. 전체 화면 여부는 기억하지 않는다. 닫기는 전체 화면에서 나오는 것을 포함하고, 다시 열 때 저절로 새 Space 로 넘어가면 닫았던 공간이 되살아나는 것처럼 보이기 때문이다. 다시 전체 화면이 필요하면 초록 신호등이나 ⌃⌘F 로 들어간다.

## 재현과 확인 단계

재현(고치기 전, 출시판 0.1.0):

1. 데스크톱 앱을 열고 본 창을 초록 신호등(또는 ⌃⌘F)으로 전체 화면으로 만든다.
2. 빨간 신호등(전체 화면에서는 포인터를 위로 올려야 보인다)이나 ⌘W 를 누른다.
3. 창 내용이 사라지고 그 Space 가 검은 화면으로 남는다. 다른 Space 로 스와이프해야 빠져나온다.

확인(고친 뒤, 개발 빌드 `pnpm --filter @ganger/desktop build && pnpm --filter @ganger/desktop start`):

1. 일반 창에서 빨간 신호등과 ⌘W: 창이 바로 사라지고 Dock 아이콘·메뉴 막대 아이콘의 창 열기로 다시 열린다.
2. 전체 화면에서 빨간 신호등과 ⌘W: 전체 화면에서 나오는 움직임 뒤 창이 사라지고, 원래 데스크톱 Space 로 돌아온다. 검은 공간이 남지 않는다.
3. 여러 Space 를 둔 채 다른 Space 에 있는 일반 창을 닫기: 창이 사라지고 다시 열면 일반 창으로 나온다.
4. 2 뒤 다시 열면 일반 창으로 나온다.

이 작업 환경에서는 화면이 잠겨 있어 실제 재현을 하지 못했다. 최소 Electron 45.2.3 스크립트로 `setFullScreen(true)`를 불렀지만 `enter-full-screen`이 오지 않았고(`isFullScreen()` false), `screencapture`는 검은 화면만 찍었다. 위 확인 단계는 PR 리뷰나 운영자가 실제 화면에서 돈다.

## 완료 조건

- [x] 전체 화면 창을 닫으면 전체 화면에서 나온 뒤 숨긴다.
- [x] 단위 시험: 일반 창은 바로 숨기고, 전체 화면 창은 `leave-full-screen` 전에는 숨기지 않고 그 뒤에 숨긴다. 나오는 동안 다시 닫아도 나온 뒤 숨긴다.
- [x] 기존 데스크톱 시험이 그대로 통과한다.
- [x] 출시판 0.1.0 과 develop 의 닫기 처리가 같은지 적는다.
- [ ] 실제 화면에서 위 확인 단계를 돈다(운영자).
