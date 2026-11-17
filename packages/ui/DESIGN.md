# 디자인 시스템 규칙

`packages/ui`의 토큰과 컴포넌트를 쓰는 규칙이다. 화면을 만들거나 고치는 사람과 에이전트는 이 문서를 따른다. 값의 출처는 운영자가 고른 시안 B(`design/prototype/`)이고, 화면 구조 결정은 ADR 0007, 스택은 ADR 0003에 있다. 실제 모양은 `apps/web`의 `/ds`에서 본다.

## 꼭 지킬 것

1. **색 값을 직접 쓰지 않는다.** `packages/ui` 밖에서 hex, `rgb()`, `hsl()`, `oklch()`, `color-mix()`, `"red"` 같은 이름 색을 쓰면 `pnpm check:colors`(pre-commit, CI)가 실패한다. 색은 `@factory/ui/tokens.stylex`의 `colors`로만 쓴다. `transparent`, `currentColor`, `inherit`는 괜찮다.
2. **UI SDK(`@ui-sdk/react`)는 `packages/ui` 안에서만 import 한다.** 앱은 `@factory/ui`의 컴포넌트를 쓴다. 필요한 동작이 없으면 `packages/ui`에 컴포넌트를 더한다(ADR 0003).
3. **스타일은 StyleX로 쓴다.** `stylex.create` + `stylex.props`. 간격·글자·반경·모션도 토큰을 먼저 쓴다. 토큰에 없는 값(열 폭, 고정 높이)만 숫자로 쓴다.
4. **화면 문구는 컴포넌트에 쓰지 않는다.** 모든 글은 `apps/web/messages/ko/*.json`에 두고 `useTranslations`로 가져온다. 접근 가능한 이름(`label`, `aria-label`)도 메시지에서 온다. `packages/ui` 컴포넌트는 문구를 props로만 받는다(ADR 0005).
5. **색은 손댈 일에만 쓴다.** Human Check는 `check`(주황), Failed는 `failed`(빨강)다. 나머지 상태는 무채색이고, 강조는 포인트 파랑(`accent*`) 하나다. 러너 Online 점만 `online`(초록)을 쓴다(ADR 0007).
6. **카드와 배지를 쓰지 않는다.** 구역은 옅은 선(`borderSubtle`)과 여백으로 나눈다. 상태는 배지 대신 `Status`(점 + 글)로 보인다.
7. **변형을 새로 만들지 않는다.** 아래 표에 없는 변형이 필요하면 먼저 이 문서와 컴포넌트에 더하고, `/ds`에 미리보기를 넣는다.

## 토큰

`import { colors, space, … } from "@factory/ui/tokens.stylex"`. 모두 `stylex.defineVars`로 만든 CSS 변수다.

### 색 `colors`

| 묶음    | 토큰                                                              | 쓰는 곳                                                                    |
| ------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 바탕    | `bgCanvas` < `bgSidebar` < `bgPanel` < `bgRaised`                 | 화면 바탕 < 사이드바 < 상세 패널 < 떠 있는 면(메뉴, 다이얼로그, 기본 버튼) |
|         | `bgHover`, `bgSelected`, `bgRaisedHover`                          | 행·항목 hover, 고른 행, 기본 버튼 hover                                    |
|         | `bgInset`, `backdrop`                                             | 입력칸 안쪽, 다이얼로그 뒤 어둡게                                          |
| 선      | `borderSubtle`                                                    | 구역·행 사이 선. 가장 많이 쓴다                                            |
|         | `borderDefault`, `borderStrong`                                   | 입력·버튼 테두리, 그 hover                                                 |
| 글자    | `textPrimary` > `textSecondary` > `textTertiary` > `textDisabled` | 제목·값 > 본문·설명 > ID·러너·시간·머리글 > 못 쓰는 상태                   |
|         | `textOnAccent`                                                    | `accent` 바탕 위 글자                                                      |
| 포인트  | `accent`, `accentHover`                                           | 주 버튼 바탕                                                               |
|         | `accentText`, `accentSoft`                                        | 링크·선택 막대·포커스 링, 선택 영역·포커스 링 바깥                         |
| 손댈 일 | `check`, `checkSoft`                                              | Human Check 글·점, 옅은 바탕                                               |
|         | `failed`, `failedSoft`, `failedBorder`                            | Failed 글·점·입력 오류, 옅은 바탕, 오류 테두리                             |
| 러너    | `online`, `onlineRing`                                            | 러너 Online 점과 그 고리에만                                               |

값은 모두 OKLCH 다크 값이다. 테스트(`tokens.test.ts`)가 OKLCH인지, 채도 있는 색이 포인트·Human Check·Failed·Online에만 있는지 검사한다.

### 글자

위계는 세 단계다. 행에서는 제목만 밝고 굵게, ID·러너·시간은 흐리게, 숫자는 `numeric`(tabular-nums)으로 둔다.

| 단계          | `Text` 변형 | 크기 / 굵기 | 쓰는 곳                              |
| ------------- | ----------- | ----------- | ------------------------------------ |
| 1 화면을 대표 | `page`      | 22 / 600    | 페이지 제목. 화면에 하나             |
|               | `panel`     | 17 / 600    | 상세 패널·다이얼로그 제목            |
| 2 읽는 내용   | `section`   | 14 / 600    | 목록 구역 제목                       |
|               | `title`     | 14 / 500    | 행 제목(`RowTitle`과 같다)           |
|               | `body`      | 14 / 400    | 설명 문단, 패널의 이유               |
| 3 흐린 보조   | `ui`        | 13 / 400    | 일반 UI 글(본문 기본 크기)           |
|               | `meta`      | 13 / 400    | ID, 러너, 시간처럼 흐린 값           |
|               | `label`     | 12 / 500    | 열 머리글, 패널 블록 제목, 작은 라벨 |

토큰: `fontSize`(`page 22`, `panel 17`, `body 14`, `ui 13`, `small 12`, `label 11`, `input 16`), `fontWeight`(`regular`, `medium`, `semibold`), `lineHeight`(`tight`, `snug`, `normal`, `relaxed`), `letterSpacing`(`page`, `panel`, `label`), `fonts`(`sans`, `mono`). 굵기는 이 세 개만 쓴다.

### 간격 `space`, 반경 `radius`, 그림자 `shadow`, 모션 `motion`, 크기 `size`

- `space`: `s1 4` `s2 8` `s3 12` `s4 16` `s5 20` `s6 24` `s8 32` `s10 40`. 아이콘과 글 사이처럼 좁은 틈에만 `px2 2`, `px6 6`.
  - 목록 화면 여백 `s8`, 구역 사이 `s10`, 패널 안 블록 사이 `s6`, 버튼 사이 `s2`.
- `radius`: `sm 4`(메뉴 항목), `md 6`(버튼, 입력, 팝업), `full`(점).
- `shadow.popover`: 떠 있는 면(메뉴, Select 목록, 툴팁, 다이얼로그, 토스트)에만. 구역에는 그림자를 쓰지 않는다.
- `motion`: `easeOut`, `durationFast 150ms`(hover·팝업), `durationToast 180ms`. 상태가 바뀔 때만 짧게 움직이고, `prefers-reduced-motion`에서는 끈다.
- `size`: `sidebarWidth 216`, `panelWidth 384`, `editorListWidth 320`, `control 32`(버튼), `input 36`, `rowMinHeight 52`, `dot 7`.

### 테마

지금은 다크만 있다. `colors`의 기본값이 다크 값이다. 라이트를 더할 때는 `tokens.stylex.ts`에 `stylex.createTheme(colors, { … })`로 **모든 키**를 채운 라이트 테마를 만들고, 루트에서 운영자 설정에 따라 테마 클래스를 붙인다. 컴포넌트는 토큰만 쓰므로 고칠 필요가 없다.

## 컴포넌트

`import { … } from "@factory/ui"`. 모두 SSR에서 렌더되고, 하이드레이션 뒤 동작이 붙는다.

### 화면 틀

| 컴포넌트                                                              | 언제                                                                                                                                                                                               |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SplitView`                                                           | 운영 화면의 기본 틀. 왼쪽 목록, 오른쪽 `panelWidth` 상세 패널(ADR 0007). 홈, Tickets, Runs, Runners, Stats. Settings는 `variant="editor"`(왼쪽 `editorListWidth` 항목 목록, 오른쪽 넓은 편집 영역) |
| `PageHeader`                                                          | 목록 위 페이지 제목·부제·오른쪽 행동                                                                                                                                                               |
| `Section`                                                             | 목록 화면의 구역(손댈 일, 실행 중, Queued). 제목 + 개수 + 오른쪽 흐린 메모                                                                                                                         |
| `DetailPanel` > `PanelHeader`, `Actions`, `PanelBlock`, `PanelFooter` | 상세 패널 안. 상태 줄 → 제목 → 흐린 부제 → 이유 → 버튼 → 속성 블록 → 바닥 순서                                                                                                                     |
| `Actions`                                                             | 버튼 줄. 주 버튼을 맨 앞에                                                                                                                                                                         |

### 목록

| 컴포넌트                               | 언제·규칙                                                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Table` + `TableHead`/`TableHeader`    | 정렬된 열 목록. `columns`에 grid 열 값을 준다. 첫 열(제목)은 `minmax(0, 1fr)`, 나머지는 고정 폭                                                                          |
| `TableRows` + `TableRow` + `TableCell` | 고를 수 있는 행. 행을 고르면 패널이 바뀐다(클릭, 위아래 화살표). `TableRows`에 `label`, 행에 `label`(보통 제목)을 준다. 상세 화면이 있으면 `onOpen`(두 번 누르기, Enter) |
| `RowTitle`                             | 행 제목. 행에서 가장 밝고 굵은 글은 이것 하나                                                                                                                            |
| `RowReason`                            | **손댈 일 행에만** 제목 아래 이유 한 줄. 앞에 `Dot`                                                                                                                      |
| `TableCell align="end" numeric`        | 시간·개수 열                                                                                                                                                             |
| `TableEmpty`                           | 목록이 비었을 때 한 줄                                                                                                                                                   |
| `DefinitionList` + `DefinitionItem`    | 패널 속성(러너, 에이전트, 경과 시간, PR, CI). 값이 없으면 `empty`로 흐리게                                                                                               |

### 상태

| 컴포넌트 | 변형                                                    | 규칙                                                                                                                   |
| -------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `Status` | `tone`: `check`, `failed`, `running`, `neutral` / `dot` | Human Check → `check`, Failed → `failed`, 실행 중 → `running`, Merged·Queued → `neutral`. 표의 상태 열은 `dot={false}` |
| `Dot`    | `tone`: 위 넷 + `online`, `offline`                     | 러너 Online·Offline, 행의 이유 줄. 옆에 글이 없으면 `label`을 준다                                                     |

### 행동과 입력

| 컴포넌트                                                            | 변형                                                             | 규칙                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`                                                            | `variant`: `default`, `primary`, `ghost`                         | `primary`는 화면(패널)에서 가장 먼저 할 행동 하나에만. Failed 패널의 "새 런 시작", Human Check의 "PR 열기". 덜 중요한 행동은 `ghost`                                                                                                         |
| `Tabs` + `Tab` (+ `TabPanel`)                                       | `count`, `attention`                                             | 목록 위 밑줄 필터. 손댈 일 탭은 `attention`(개수를 밝고 굵게, 색 없음)                                                                                                                                                                       |
| `Menu` + `MenuRadio`/`MenuRadioOption`, `MenuItem`, `MenuSeparator` |                                                                  | 누르면 열리는 행동·선택 목록. Workspace 전환기처럼 하나를 고르면 `MenuRadio`(고르면 닫힌다). 폼 안 값 고르기는 `Select`                                                                                                                      |
| `Field` + `Input`/`Select`                                          | `Input mono`, `readOnly`, `Field error`, `SelectOption disabled` | 라벨은 위, 도움말(`description`)은 아래, 오류는 `error`로 빨간 글과 테두리. 경로·주소·키는 `mono`. 복사만 하는 값은 `readOnly`. 목록에 보이되 고를 수 없는 항목은 `disabled`로 두고 이유를 `label`에 함께 쓴다(수동 할당의 인증이 깨진 러너) |
| `Tooltip`                                                           | `labelsTrigger`, `side`                                          | 아이콘 버튼의 이름, 잘린 값의 전체만. 누를 것을 넣지 않는다                                                                                                                                                                                  |
| `Dialog` + `DialogClose`                                            | `triggerVariant`, `DialogClose variant`                          | 되돌릴 수 없는 행동 확인(지우기, 연결 끊기)과 할당 확인(Mapping 기본값을 보이고 러너·에이전트만 바꿈)만. 그 밖의 편집은 패널이나 Settings 편집 영역에서 한다. 주 버튼(`primary`)을 마지막에                                                  |
| `Toaster` + `showToast`                                             |                                                                  | 앱 루트에 `Toaster` 하나. 끝난 행동을 짧게 알린다("저장했어요"). 실패처럼 읽고 판단할 내용은 화면 안에 남긴다                                                                                                                                |

### 티켓 목록에서 바꾼 것

티켓 0003의 목록(Button, Badge, Table, Card, Tabs, Dialog, Menu/Select, Tooltip, Toast, Input)을 시안 B의 실제 쓰임에 맞췄다.

- **Badge → `Status`·`Dot`**: B는 배지 대신 점 + 글로 상태를 보인다.
- **Card → 없음**: B는 카드를 쓰지 않는다(ADR 0007). 대신 `SplitView`, `Section`, `DetailPanel` 묶음으로 구역을 나눈다.
- **더한 것**: 목록 + 상세 패널 분할(`SplitView`, `DetailPanel` 묶음), 정의 목록(`DefinitionList`), 글자 위계(`Text`), `PageHeader`, `Section`.
- **Menu/Select는 둘로 나눴다**: 행동·전환 메뉴는 `Menu`, 폼 값은 `Select`.

## 새 컴포넌트를 더할 때

1. 동작은 `@ui-sdk/react`의 부품으로, 스타일은 StyleX와 토큰으로 `src/components/`에 만든다. UI SDK 상태별 스타일은 `className={(s) => cx(...)}`로 고른다(StyleX는 `data-*` 선택자를 쓰기 어렵다).
2. 문구는 props로 받는다. 기본 문구를 컴포넌트에 넣지 않는다.
3. `src/index.ts`에서 export 하고, `components.test.tsx`에 서버 렌더 테스트를, `/ds`(`apps/web/src/ds/`)에 미리보기를, 이 문서에 언제 쓰는지를 더한다.
4. UI SDK는 `0.1.0-beta`라 버전을 고정했다. 올릴 때는 `pnpm typecheck`(특히 `exactOptionalPropertyTypes`)와 `/ds`를 다시 확인한다.
