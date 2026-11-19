---
status: doing
blocked_by: []
---

# 0113 데스크톱 창 제목 표시줄 없애기(시안 T3)

## 목표

데스크톱 앱 창의 macOS 기본 제목 표시줄을 없애고 신호등만 남긴다. 모든 화면의 제목과 요약을 콘텐츠 맨 위 56px 한 줄 머리에 두고, 그 줄이 신호등과 같은 높이에 온다.

## 배경

데스크톱 앱 창(`apps/desktop/src/main/controller.ts`의 `new BrowserWindow`)이 macOS 기본 제목 표시줄을 써서, 어두운 앱 위에 회색 띠와 "Ganger" 제목이 따로 떠 이질적이다(운영자 지적 2026-11-19). 운영자가 시안 T3을 골랐다(2026-11-19).

## 운영자 결정(시안 T3)

- **창.** 제목 표시줄을 숨기고 macOS 신호등만 남긴다(`titleBarStyle: "hidden"` + `trafficLightPosition`). 신호등은 왼쪽 레일(84px) 위쪽 56px 줄의 가운데 높이에, 레일 안에 둔다. 창 `backgroundColor`를 Ink 토큰 값으로 둬 열 때 흰 화면이 번쩍이지 않게 한다. 알림 설정 창도 같은 방식으로 맞춘다.
- **한 줄 머리.** 모든 화면의 제목(화면 이름)과 요약 한 줄을 콘텐츠 맨 위 56px 한 줄에 나란히 둔다(제목 왼쪽, 요약 문장이 그 옆, 오른쪽에는 그 화면의 머리 행동). 줄 아래에 얇은 구분선을 둔다.
- **레일.** 맨 위 56px은 신호등 자리로 비운다. 그 아래 Workspace 바꾸기, 메뉴. 호루라기 마크(`GangerMark`)는 레일 맨 아래로 옮긴다.
- **창 끌기.** 데스크톱 앱에서는 머리 줄 전체와 레일 위 56px을 창 끌기 영역(`-webkit-app-region: drag`)으로 두고, 그 안의 버튼·링크·입력은 `no-drag`로 뺀다. 더블클릭 확대는 macOS 기본대로 된다.
- **웹과 데스크톱.** 머리 줄 배치와 마크 위치는 웹과 데스크톱이 같다. 신호등 자리 비우기와 창 끌기는 데스크톱 앱에서만 한다. 웹 브라우저에서는 레일 위 빈 자리를 두지 않는다.
- ADR 0010의 제목 규칙("화면 이름 + 그 아래 한 줄 요약")을 "한 줄 머리"로 갱신한다.

## 결정: 데스크톱 판단은 쿠키로 한다

0102는 preload가 연 다리(`gangerDesktopNavigation`)가 있는지로 데스크톱 앱인지 판단한다. 이 판단은 브라우저에서 화면을 그린 뒤에야 알 수 있다. 서버가 그린 첫 화면(SSR)에는 레일 위 빈 자리가 없다가, 화면이 살아나면서 56px이 밀려 내려간다. 또 이 기능이 없는 예전 데스크톱 앱(제목 표시줄이 그대로 있다)도 0102의 다리는 갖고 있어, 새 서버를 열면 쓸데없는 빈 자리가 생긴다.

그래서 제목 표시줄을 숨긴 창만 서버 화면을 열기 전에 그 서버 주소에 쿠키(`ganger-title-bar=hidden`)를 심고, 서버가 첫 화면부터 쿠키를 읽어 그린다(시간대 쿠키와 같은 방식). 0102의 다리 판단은 단축키 표시에 그대로 쓴다.

## 범위

- `packages/ui`: `PageHeader`를 한 줄 머리로 바꾸고 선택 속성 `lead`(제목 앞 링크)를 더한다. 머리 줄을 본문 위에 두는 `ScreenLayout`, 창 문맥 `WindowChrome`·`useTitleBarHidden`, 레일 없는 화면의 끌기 띠 `WindowDragStrip`, 창 틀 값(`@ganger/ui/window-frame`)을 더한다. `AppFrame`은 제목 표시줄을 숨긴 창에서 레일 위 56px을 비운다. `Sheet`·`Dialog`는 끌기에서 뺀다. 토큰 `size.titleBar`, `size.pageHeadingMinWidth`.
- `apps/web`: 모든 화면(Dashboard·Tickets·Runs·Run 상세·Runners·Stats·Settings, 준비 중 화면)의 머리를 한 줄 머리로 옮긴다. 레일 순서를 Workspace → 메뉴 → 마크로 바꾼다. 온보딩·없는 주소 화면에 끌기 띠를 둔다. 전역 CSS에 `data-app-region` 규칙.
- `apps/desktop`: 본 창·알림 설정 창 옵션을 `window-options.ts`로 빼고 제목 표시줄을 숨긴다. 서버 화면을 열 때 쿠키를 심는다. 로컬 화면·알림 설정 창에 끌기 띠를 둔다.
- 문서: ADR 0010, `packages/ui/DESIGN.md`, `/ds` 앱 틀 미리보기(웹·데스크톱).

## 완료 조건

- 시험(`packages/ui`): 셸 렌더 — 데스크톱일 때만 끌기 영역과 레일 위 빈 자리, 웹은 없음. 머리 줄 구조(제목·요약·행동, 안의 링크는 `no-drag`). 창 바탕 색이 Ink 토큰과 같음.
- 시험(데스크톱): `BrowserWindow` 옵션(`titleBarStyle`, `trafficLightPosition`, `backgroundColor`), 서버 쿠키.
- e2e: 화면 제목이 그대로 읽히고, 쿠키가 있을 때만 레일 위 빈 자리와 끌기 영역이 있다.
- 스크린숏: 데스크톱 앱 Dashboard·Runs·Runners 위쪽, 웹 Dashboard 위쪽, 400px 폭.
- 마무리 리뷰: `better-interface` 리뷰 → HIGH·MEDIUM 고침 → `interface-review`로 새 서브에이전트 리뷰 → 표를 PR 본문에.
