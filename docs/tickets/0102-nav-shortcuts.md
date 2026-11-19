---
status: doing
blocked_by: []
---

# 0102 화면 이동 단축키(⌘1–5, ⌘,)

## 목표

데스크톱 앱에서 키보드만으로 화면을 옮긴다. 레일 순서대로 ⌘1 Dashboard, ⌘2 Tickets, ⌘3 Runs, ⌘4 Runners, ⌘5 Stats, ⌘, Settings(Windows·Linux는 Ctrl). 레일 툴팁에서 키를 알 수 있다.

## 배경

운영자 결정(2026-11-19, grilling Q1–Q10, 구현 중 Q2 추가 결정). 레일을 마우스로만 누를 수 있어, 입력칸이나 답하기 패널에 있다가 다른 화면으로 가려면 손을 마우스로 옮겨야 했다.

## 결정: 웹 브라우저에서는 등록하지 않는다

웹 브라우저에서는 ⌘1–5·⌘,를 등록하지 않고 브라우저 기본 동작(1–5번째 탭으로 옮기기, 브라우저 설정 열기)을 그대로 둔다. Chrome은 이 키를 예약 키로 두지 않아 페이지가 먼저 받는다. 페이지가 받아 처리하면(기본 동작을 막으면) Ganger 탭에서는 탭 전환과 설정 열기가 막히고, 막지 않으면 탭 전환과 Ganger 화면 이동이 같이 일어난다. 둘 다 브라우저 사용자를 놀라게 하므로 단축키는 데스크톱 앱에서만 동작한다. 그래서 브라우저별로 어떤 키가 페이지에 오는지 재는 표는 두지 않는다.

## 결정: TanStack Hotkeys를 들이지 않는다

처음에는 웹 핸들러를 TanStack Hotkeys(`@tanstack/react-hotkeys`)로 만들었다(`useHotkeys`, 루트 `HotkeysProvider`). 웹에서 등록하지 않기로 하면서 이 라이브러리가 하던 일이 없어졌다. 데스크톱 앱의 키는 Electron 메뉴 accelerator가 앱 수준에서 받으므로 포커스가 입력칸·답하기 패널 안에 있어도 동작하고, 렌더러가 따로 키를 들을 필요가 없다. 렌더러에서도 TanStack Hotkeys를 켜면 메뉴와 같은 키를 두 군데서 처리하게 되어 한쪽을 다시 꺼야 한다. 그래서 의존성을 빼고 메뉴 accelerator 하나로 처리한다. 앞으로 앱 안 단축키(목록 이동, `?` 목록, 키 바꾸기)를 더할 때 TanStack Hotkeys를 다시 판단한다. 그때는 0.x라 정확한 버전으로 고정하고, 공개 기간 검사 예외(`minimumReleaseAgeExclude`)를 함께 넣고, 어댑터만 설치한다(코어가 두 벌이면 scope가 어긋난다).

## 범위

- **키 정의 한 곳.** `packages/app/src/shell/nav-shortcuts.ts`의 타입 있는 목록(화면, 경로, `Mod+1` 같은 키)을 레일 순서, 레일 툴팁, 데스크톱 메뉴, preload가 함께 쓴다. 데스크톱은 `Mod+`를 Electron의 `CommandOrControl+`로 바꿔 쓴다.
- **데스크톱 앱.** 앱 메뉴 "보기" 다음에 "이동" 메뉴를 두고 여섯 키를 accelerator로 붙인다(문구는 `apps/desktop/messages/ko/system.json`). 누르면 main이 `desktop:navigate` IPC로 화면 이름을 보내고, preload가 서버 화면에 연 `gangerDesktopNavigation.onNavigate`로 웹 라우터에 넘긴다. 웹은 레일을 누른 것처럼 문서를 다시 읽지 않고 옮기고 Workspace(`ws`)를 지킨다. 받는 쪽이 없으면(이 기능이 없는 서버) preload가 그 경로로 주소를 바꾼다. 서버 화면이 열리지 않았으면 메뉴 항목을 끈다. 입력칸·답하기 패널 안에서 눌러도 쓰다 만 답을 묻지 않고 바로 옮긴다.
- **보여 주기.** 레일 링크에 마우스를 올리거나 포커스하면 툴팁에 이름을 보인다. 데스크톱 앱 안에서는 "Runs ⌘3"(맥) 또는 "Runs Ctrl+3"처럼 키를 함께 보이고 링크에 `aria-keyshortcuts`를 단다. 웹 브라우저에서는 키를 보이지 않는다. `packages/ui` `Tooltip`에 선택 속성 `shortcut`(UI SDK `TooltipShortcut`)과 `render`(링크 같은 요소를 트리거로)를 더한다.
- **문서.** GLOSSARY "단축키", DESIGN.md 툴팁·레일, /ds 툴팁 예시.

## 역할 나누기

ADR 0003은 키보드·포커스를 UI SDK에 맡긴다. 포커스·팝업 안 키(메뉴, 다이얼로그, 툴팁)는 UI SDK, 앱 전역 단축키는 데스크톱 앱 메뉴 accelerator가 맡는다. 툴팁의 키 표시(`shortcut`)는 UI SDK가 보이기만 하고 키를 묶지 않는다.

## 완료 조건

- 시험(`packages/app`): 키 정의 목록 — 레일 순서, 키·경로가 겹치지 않음, 밖에서 받은 화면 이름 검사.
- 시험(`packages/ui`): `Tooltip`의 `render`가 링크를 트리거로 쓰고 `shortcut`이 `aria-keyshortcuts`와 키 표시를 더한다.
- 시험(데스크톱): "이동" 메뉴 템플릿 — 여섯 항목의 문구·accelerator·켜짐, 누르면 그 화면, 서버 화면이 없으면 꺼짐.
- 웹 브라우저 시험: 브라우저에서는 Mod+1..5, Mod+,가 화면을 옮기지 않고 툴팁에 키가 없다. 데스크톱 다리가 있으면 툴팁에 이름과 키, `aria-keyshortcuts`가 있고, 메뉴가 보낸 화면으로 문서를 다시 읽지 않고 옮기며 `ws`를 지킨다(입력칸에 포커스가 있어도).
- 스크린숏: 데스크톱 앱 레일 툴팁(키 표시) 1280px. 데스크톱 "이동" 메뉴는 가능하면.
- 마무리 리뷰: `better-interface` 리뷰 → HIGH·MEDIUM 고침 → `interface-review`로 새 서브에이전트 리뷰 → 표를 PR 본문에.

## 다음에

- 목록 안 이동 키(위·아래로 행 옮기기)
- 고른 항목 동작 키(할당, 답하기 등)
- `?`로 단축키 목록 보기
- 글자 단축키를 끄는 설정(WCAG 2.1.4, 글자 한 개 단축키를 더할 때)
- 키 바꾸기
- 명령 팔레트
- 웹 브라우저에서 쓸 단축키(브라우저 예약 키와 겹치지 않는 조합으로 따로 정하기)
