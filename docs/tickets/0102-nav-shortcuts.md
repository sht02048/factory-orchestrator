---
status: doing
blocked_by: []
---

# 0102 화면 이동 단축키(⌘1–5, ⌘,)

## 목표

키보드만으로 화면을 옮긴다. 레일 순서대로 ⌘1 Dashboard, ⌘2 Tickets, ⌘3 Runs, ⌘4 Runners, ⌘5 Stats, ⌘, Settings(Windows·Linux는 Ctrl). 웹과 데스크톱 앱에서 같은 키를 쓰고, 레일 툴팁에서 키를 알 수 있다.

## 배경

운영자 결정(2026-11-19, grilling Q1–Q10). 레일을 마우스로만 누를 수 있어, 입력칸이나 답하기 패널에 있다가 다른 화면으로 가려면 손을 마우스로 옮겨야 했다.

## 범위

- **키 정의 한 곳.** `packages/app/src/shell/nav-shortcuts.ts`의 타입 있는 목록(화면, 경로, `Mod+1` 같은 키)을 레일 순서, 레일 툴팁, 웹 핸들러, 데스크톱 메뉴가 함께 쓴다. 데스크톱은 `Mod+`를 Electron의 `CommandOrControl+`로 바꿔 쓴다.
- **웹.** TanStack Hotkeys(`@tanstack/react-hotkeys`)로 묶는다. 루트에 `HotkeysProvider`(기본 `requireReset`)를 두고, 앱 셸의 `NavHotkeys`가 `useHotkeys`로 여섯 키를 등록한다. 입력칸·답하기 패널 안에서 눌러도 레일을 누른 것처럼 바로 옮긴다(`Mod` 조합은 라이브러리 기본으로 입력칸에서도 동작한다). Workspace(`ws`)는 레일 링크처럼 지킨다.
- **데스크톱 앱.** 앱 메뉴 "보기" 다음에 "이동" 메뉴를 두고 여섯 키를 accelerator로 붙인다(문구는 `apps/desktop/messages/ko/system.json`). 누르면 main이 `desktop:navigate` IPC로 화면 이름을 보내고, preload가 서버 화면에 연 `gangerDesktopNavigation.onNavigate`로 웹 라우터에 넘긴다. 받는 쪽이 없으면(이 기능이 없는 서버) preload가 그 경로로 주소를 바꾼다. 서버 화면이 열리지 않았으면 메뉴 항목을 끈다. 데스크톱 안에서는 웹 단축키를 끄고 메뉴에 맡겨 같은 키를 두 번 처리하지 않는다.
- **보여 주기.** 레일 링크에 마우스를 올리거나 포커스하면 툴팁에 "Runs ⌘3"(맥) 또는 "Runs Ctrl+3"처럼 이름과 키를 보인다. 링크에는 `aria-keyshortcuts`를 단다. `packages/ui` `Tooltip`에 선택 속성 `shortcut`(UI SDK `TooltipShortcut`)과 `render`(링크 같은 요소를 트리거로)를 더한다.
- **문서.** GLOSSARY "단축키", DESIGN.md 툴팁·레일, /ds 툴팁 예시.

## 역할 나누기

ADR 0003은 키보드·포커스를 UI SDK에 맡긴다. 포커스·팝업 안 키(메뉴, 다이얼로그, 툴팁)는 UI SDK, 앱 전역 단축키는 TanStack Hotkeys가 맡는다. 툴팁의 키 표시(`shortcut`)는 UI SDK가 보이기만 하고 키를 묶지 않는다.

## 0.x 위험

`@tanstack/react-hotkeys`는 0.x(alpha)라 정확한 버전 `0.27.1`(코어 `@tanstack/hotkeys@0.33.0`)로 고정했다. 0.x는 마이너 버전에서도 API가 바뀔 수 있어, 올릴 때 변경 기록을 읽고 웹 브라우저 시험(`e2e/src/nav-shortcuts.test.ts`)을 돌린다. 공개 하루 안의 버전이라 `pnpm-workspace.yaml`의 `minimumReleaseAgeExclude`에 정확한 버전으로 넣었다. 버전을 올리면 이 목록도 같은 버전으로 바꾼다. 어댑터만 설치하고 코어를 따로 설치하지 않는다(코어가 두 벌이면 scope가 어긋난다).

## 브라우저가 페이지에 넘기는 키(추정)

실측하지 못했다. Playwright 키 입력은 브라우저 단축키 처리를 거치지 않고, OS 키 입력은 작업 환경에 손쉬운 사용 권한이 없어 보내지 못했다. Firefox는 작업 기계에 없다. 아래는 Chromium·WebKit·Gecko 동작 지식으로 적은 추정이고, 운영자가 직접 눌러 확인한다(PR 본문의 확인 항목).

| 키    | Chrome(맥)                                        | Safari                              | Firefox                  | 브라우저 기본 동작    |
| ----- | ------------------------------------------------- | ----------------------------------- | ------------------------ | --------------------- |
| ⌘1–⌘5 | 페이지가 먼저 받음(추정, Chromium 예약 키가 아님) | 페이지가 먼저 받음(추정)            | 페이지가 먼저 받음(추정) | 1–5번째 탭으로 옮기기 |
| ⌘,    | 페이지가 먼저 받음(추정)                          | 페이지가 먼저 받음(추정, 확신 낮음) | 페이지가 먼저 받음(추정) | 브라우저 설정 열기    |

예약 키(⌘T, ⌘W, ⌘N, ⌘Q, 탭 순환 등)는 쓰지 않는다. 페이지가 받은 키를 Ganger가 처리하면서 브라우저 기본 동작을 막을지는 `apps/web/src/shell/nav-hotkeys.tsx`의 한 값으로 정한다.

## 완료 조건

- 시험(`packages/app`): 키 정의 목록 — 레일 순서, 키·경로가 겹치지 않음, 밖에서 받은 화면 이름 검사.
- 시험(`packages/ui`): `Tooltip`의 `render`가 링크를 트리거로 쓰고 `shortcut`이 `aria-keyshortcuts`와 키 표시를 더한다.
- 시험(데스크톱): "이동" 메뉴 템플릿 — 여섯 항목의 문구·accelerator·켜짐, 누르면 그 화면, 서버 화면이 없으면 꺼짐.
- 웹 브라우저 시험: Mod+1..5, Mod+, 로 문서를 다시 읽지 않고 옮기고 `ws`를 지킨다, 입력칸 안에서도 옮긴다, 레일 툴팁에 이름과 키, 데스크톱 다리가 있으면 키를 메뉴에 맡기고 메뉴가 보낸 화면으로 옮긴다.
- 스크린숏: 레일 툴팁(키 표시) 1280px. 데스크톱 "이동" 메뉴는 가능하면.
- 마무리 리뷰: `better-interface` 리뷰 → HIGH·MEDIUM 고침 → `interface-review`로 새 서브에이전트 리뷰 → 표를 PR 본문에.

## 다음에

- 목록 안 이동 키(위·아래로 행 옮기기)
- 고른 항목 동작 키(할당, 답하기 등)
- `?`로 단축키 목록 보기(TanStack app hotkeys로 옮기면 `useAppHotkeyList`로 만들 수 있다)
- 글자 단축키를 끄는 설정(WCAG 2.1.4, 글자 한 개 단축키를 더할 때)
- 키 바꾸기(app hotkeys의 custom hotkeys)
- 명령 팔레트
