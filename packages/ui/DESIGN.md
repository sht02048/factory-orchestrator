# 디자인 시스템 규칙

`packages/ui`의 토큰과 컴포넌트를 쓰는 규칙이다. 화면을 만들거나 고치는 사람과 에이전트는 이 문서를 따른다. 값의 출처는 운영자가 고른 시안 B(`design/prototype/`)와 [ADR 0010](../../docs/adr/0010-ui-words-and-visual-rules.md)(낱말과 시각 규칙)이고, 화면 구조 결정은 ADR 0007·0010, 스택은 ADR 0003에 있다. 이 문서와 ADR 0010이 다르면 ADR 0010이 앞선다. 실제 모양은 `apps/web`의 `/ds`에서 본다.

## 꼭 지킬 것

1. **색 값을 직접 쓰지 않는다.** `packages/ui` 밖에서 hex, `rgb()`, `hsl()`, `oklch()`, `color-mix()`, `"red"` 같은 이름 색을 쓰면 `pnpm check:colors`(pre-commit, CI)가 실패한다. 색은 `@factory/ui/tokens.stylex`의 `colors`로만 쓴다. `transparent`, `currentColor`, `inherit`는 괜찮다.
2. **UI SDK(`@ui-sdk/react`)는 `packages/ui` 안에서만 import 한다.** 앱은 `@factory/ui`의 컴포넌트를 쓴다. 필요한 동작이 없으면 `packages/ui`에 컴포넌트를 더한다(ADR 0003).
3. **스타일은 StyleX로 쓴다.** `stylex.create` + `stylex.props`. 간격·글자·반경·모션도 토큰을 먼저 쓴다. 토큰에 없는 값(열 폭, 고정 높이)만 숫자로 쓴다.
4. **화면 문구는 컴포넌트에 쓰지 않는다.** 모든 글은 `apps/web/messages/ko/*.json`에 두고 `useTranslations`로 가져온다. 접근 가능한 이름(`label`, `aria-label`)도 메시지에서 온다. `packages/ui` 컴포넌트는 문구를 props로만 받는다(ADR 0005).
5. **색 하나에 뜻 하나다(ADR 0010 5번).** 상태 색은 여섯 뜻뿐이다: 보라 `answer`(사람이 답·허용), 노랑 `check`(사람이 확인), 빨강 `problem`(문제), 초록 `progress`(진행·정상), 파랑 `merged`(병합), 회색 `idle`(대기·멈춤). 상태 색은 화면이 고르지 않고 `StatusPill`이 상태 값으로 고른다. 그 밖의 강조는 포인트 파랑(`accent*`) 하나다.
6. **상태는 `StatusPill` 하나로만 보인다(ADR 0010 4번).** 점 + GLOSSARY 영어 이름. 영역은 선이 아니라 면(`bgCard`, `bgPanel`)으로 나누고, 손댈 일·러너처럼 한 덩어리는 `Card`로 묶는다.
7. **변형을 새로 만들지 않는다.** 아래 표에 없는 변형이 필요하면 먼저 이 문서와 컴포넌트에 더하고, `/ds`에 미리보기를 넣는다.

## 토큰

`import { colors, space, … } from "@factory/ui/tokens.stylex"`. 모두 `stylex.defineVars`로 만든 CSS 변수다.

### 색 `colors`

| 묶음   | 토큰                                                              | 쓰는 곳                                                                 |
| ------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 바탕   | `bgCanvas` < `bgSidebar` < `bgPanel` < `bgRaised`                 | 화면 바탕 < 아이콘 레일 < 상세 패널 < 떠 있는 면(메뉴, 다이얼로그)      |
|        | `bgHover`, `bgSelected`, `bgRaisedHover`                          | 행·항목 hover, 고른 행, 떠 있는 면 hover                                |
|        | `bgInset`, `backdrop`                                             | 입력칸 안쪽, 다이얼로그 뒤 어둡게                                       |
| 면     | `bgCard`, `bgCardHover`                                           | 카드(`Card`), 카드 안 행 hover                                          |
|        | `bgControl`, `bgControlHover`                                     | 보조·위험 버튼 바탕과 그 hover                                          |
| 선     | `borderSubtle`                                                    | 구역·행 사이 선. 가장 많이 쓴다                                         |
|        | `borderDefault`, `borderStrong`                                   | 입력·버튼 테두리, 그 hover                                              |
| 글자   | `textPrimary` > `textSecondary` > `textTertiary` > `textDisabled` | 제목·값 > 본문·설명 > ID·러너·시간·머리글 > 못 쓰는 상태                |
|        | `textOnAccent`                                                    | `accent` 바탕 위 글자                                                   |
| 포인트 | `accent`, `accentHover`                                           | 주 버튼 바탕                                                            |
|        | `accentText`, `accentSoft`                                        | 링크·선택 막대·포커스 링, 선택 영역·포커스 링 바깥                      |
| 상태   | `answer`, `answerSoft`                                            | 보라. Question·Permission·Waiting for Input 알약 글·점, 알약 바탕       |
|        | `check`, `checkSoft`                                              | 노랑. Human Check                                                       |
|        | `problem`, `problemSoft`, `problemBorder`                         | 빨강. Failed·Disconnected·Runner Issue·Offline, 위험 버튼 글, 입력 오류 |
|        | `progress`, `progressSoft`                                        | 초록. Running·Online                                                    |
|        | `merged`, `mergedSoft`                                            | 파랑. Merged. 주 버튼(`accent`)보다 옅어 행동과 갈린다                  |
|        | `idle`, `idleSoft`                                                | 회색(무채색). Queued·Canceled                                           |

값은 모두 OKLCH 다크 값이다. 테스트(`tokens.test.ts`)가 OKLCH인지, 채도 있는 색이 포인트와 상태 색 다섯 뜻에만 있는지, 상태 색끼리 색상이 충분히 먼지, 회색이 무채색인지 검사한다. 상태 색은 `StatusPill`·위험 버튼·입력 오류·차트(Stats의 Human Check·Failed 막대)처럼 그 뜻을 그릴 때만 쓴다.

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
- `radius`(ADR 0010 10번): `card 12`(카드, 다이얼로그), `control 8`(버튼, 행, 입력, 메뉴·팝업), `pill 6`(알약, 팝업 항목, 툴팁), `full`(점). `tokens.test.ts`가 값을 검사한다.
- `shadow.popover`: 떠 있는 면(메뉴, Select 목록, 툴팁, 다이얼로그, 토스트)에만. 구역에는 그림자를 쓰지 않는다.
- `motion`: `easeOut`, `durationFast 150ms`(hover·팝업), `durationToast 180ms`. 상태가 바뀔 때만 짧게 움직이고, `prefers-reduced-motion`에서는 끈다.
- `size`: `sidebarWidth 216`, `panelWidth 384`, `editorListWidth 320`, `control 32`(버튼), `input 36`, `rowMinHeight 52`, `dot 6`(알약 점), `pill 22`(알약 높이).

### 테마

지금은 다크만 있다. `colors`의 기본값이 다크 값이다. 라이트를 더할 때는 `tokens.stylex.ts`에 `stylex.createTheme(colors, { … })`로 **모든 키**를 채운 라이트 테마를 만들고, 루트에서 운영자 설정에 따라 테마 클래스를 붙인다. 컴포넌트는 토큰만 쓰므로 고칠 필요가 없다.

## 컴포넌트

`import { … } from "@factory/ui"`. 모두 SSR에서 렌더되고, 하이드레이션 뒤 동작이 붙는다.

### 화면 틀

| 컴포넌트                                                              | 언제                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SplitView`                                                           | 목록 화면의 기본 틀. 왼쪽 목록, 오른쪽 `panelWidth` 상세 패널(ADR 0007). Tickets, Runs, Stats. Settings는 `variant="editor"`(왼쪽 `editorListWidth` 항목 목록, 오른쪽 넓은 편집 영역). Home은 손댈 일 카드 + 오른쪽 흐름이다(ADR 0010) |
| `PageHeader`                                                          | 목록 위 페이지 제목·부제·오른쪽 행동                                                                                                                                                                                                   |
| `Section`                                                             | 목록 화면의 구역(손댈 일, Running, Queued). 제목 + 개수 + 오른쪽 흐린 메모                                                                                                                                                             |
| `DetailPanel` > `PanelHeader`, `Actions`, `PanelBlock`, `PanelFooter` | 상세 패널 안. 상태 줄 → 제목 → 흐린 부제 → 이유 → 버튼 → 속성 블록 → 바닥 순서                                                                                                                                                         |
| `Actions`                                                             | 버튼 줄. 주 버튼을 맨 앞에                                                                                                                                                                                                             |
| `Card`                                                                | 면 한 덩어리(둥글기 12). 손댈 일 카드, 러너 카드, Run 상세의 정보·타임라인. 이름(`label`)을 주면 `section`. 행을 담으면 `padding="compact"`                                                                                            |
| `Row`                                                                 | 카드 안 한 줄(둥글기 8). 앞(`leading`, 아이콘·알약) · 본문 · 뒤(`trailing`, 시간 같은 흐린 값)                                                                                                                                         |

### 목록

| 컴포넌트                               | 언제·규칙                                                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Table` + `TableHead`/`TableHeader`    | 정렬된 열 목록. `columns`에 grid 열 값을 준다. 첫 열(제목)은 `minmax(0, 1fr)`, 나머지는 고정 폭                                                                          |
| `TableRows` + `TableRow` + `TableCell` | 고를 수 있는 행. 행을 고르면 패널이 바뀐다(클릭, 위아래 화살표). `TableRows`에 `label`, 행에 `label`(보통 제목)을 준다. 상세 화면이 있으면 `onOpen`(두 번 누르기, Enter) |
| `RowTitle`                             | 행 제목. 행에서 가장 밝고 굵은 글은 이것 하나                                                                                                                            |
| `RowReason`                            | **손댈 일 행에만** 제목 아래 이유 한 줄                                                                                                                                  |
| `TableCell align="end" numeric`        | 시간·개수 열                                                                                                                                                             |
| `TableEmpty`                           | 목록이 비었을 때 한 줄                                                                                                                                                   |
| `DefinitionList` + `DefinitionItem`    | 패널 속성(러너, 에이전트, 경과 시간, PR, CI). 값이 없으면 `empty`로 흐리게                                                                                               |

### 상태

| 컴포넌트     | 받는 값                                     | 규칙                                                                                                                                                                                                         |
| ------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `StatusPill` | `status`: `PillStatus`, children: 상태 이름 | 런 상태·요약 결과·러너 Online/Offline·손댈 일 종류를 모두 이것 하나로 그린다. 색은 `statusTone(status)`가 ADR 0010 5번 표대로 고른다. 이름은 메시지 파일의 GLOSSARY 영어 용어(웹은 `useStatusName`)를 넘긴다 |

화면은 색이나 톤을 고르지 않는다. 상태가 아닌 값(에이전트 결과, PR 상태, "할당 전")은 알약이 아니라 글로 둔다.

### 행동과 입력

| 컴포넌트                                                            | 변형                                                             | 규칙                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`                                                            | `variant`: `primary`, `secondary`(기본), `danger`, `ghost`       | ADR 0010 6번. 렌더하면 `data-variant`가 붙어 화면 시험이 주 버튼 수를 센다. 링크에 버튼 모양을 입힐 때는 `buttonStyles(variant)`와 `data-variant`를 함께 쓴다. `primary`(파랑)는 화면 전체에서 주 행동 하나에만. 카드 행동과 질문 선택지는 모두 `secondary`(질문 선택지를 칠하지 않는다). 취소·거절 같은 위험 행동은 `danger`(빨간 글자 보조). 닫기·접기처럼 덜 중요한 행동은 `ghost` |
| `Tabs` + `Tab` (+ `TabPanel`)                                       | `count`, `attention`, `variant="chips"`                          | 목록 위 밑줄 필터. 손댈 일 탭은 `attention`(개수를 밝고 굵게, 색 없음). Runs의 상태 칩 필터는 `variant="chips"`(둥근 칩, 고른 칩만 밝은 면)                                                                                                                                                                                                                                           |
| `Menu` + `MenuRadio`/`MenuRadioOption`, `MenuItem`, `MenuSeparator` | `variant`: `default`, `rail`                                     | 누르면 열리는 행동·선택 목록. Workspace 바꾸기처럼 하나를 고르면 `MenuRadio`(고르면 닫힌다). 폼 안 값 고르기는 `Select`. `rail`은 아이콘 레일 맨 위 Workspace 바꾸기(테두리·화살표 없이 위아래로 쌓고 오른쪽에 연다)                                                                                                                                                                  |
| `Field` + `Input`/`Select`                                          | `Input mono`, `readOnly`, `Field error`, `SelectOption disabled` | 라벨은 위, 도움말(`description`)은 아래, 오류는 `error`로 빨간 글과 테두리. 경로·주소·키는 `mono`. 복사만 하는 값은 `readOnly`. 목록에 보이되 고를 수 없는 항목은 `disabled`로 두고 이유를 `label`에 함께 쓴다(수동 할당의 인증이 깨진 러너)                                                                                                                                          |
| `Tooltip`                                                           | `labelsTrigger`, `side`                                          | 아이콘 버튼의 이름, 잘린 값의 전체만. 누를 것을 넣지 않는다                                                                                                                                                                                                                                                                                                                           |
| `Dialog` + `DialogClose`                                            | `triggerVariant`, `DialogClose variant`                          | 되돌릴 수 없는 행동 확인(지우기, 연결 끊기)과 할당 확인(Mapping 기본값을 보이고 러너·에이전트만 바꿈)만. 그 밖의 편집은 패널이나 Settings 편집 영역에서 한다. 주 버튼(`primary`)을 마지막에                                                                                                                                                                                           |
| `Toaster` + `showToast`                                             |                                                                  | 앱 루트에 `Toaster` 하나. 끝난 행동을 짧게 알린다("저장했어요"). 실패처럼 읽고 판단할 내용은 화면 안에 남긴다                                                                                                                                                                                                                                                                         |

### 티켓 목록에서 바꾼 것

티켓 0003의 목록(Button, Badge, Table, Card, Tabs, Dialog, Menu/Select, Tooltip, Toast, Input)을 시안 B의 실제 쓰임에 맞췄다.

- **Badge → `StatusPill`**: 점 + 이름 알약 하나(ADR 0010 4번). 처음에는 `Status`·`Dot`(점 + 글)이었고 0049a에서 알약 하나로 합쳤다.
- **Card**: 처음에는 쓰지 않았고(ADR 0007), ADR 0010의 카드 화면(Home 손댈 일, Runners)을 위해 0049a에서 `Card`·`Row`를 더했다.
- **더한 것**: 목록 + 상세 패널 분할(`SplitView`, `DetailPanel` 묶음), 정의 목록(`DefinitionList`), 글자 위계(`Text`), `PageHeader`, `Section`.
- **Menu/Select는 둘로 나눴다**: 행동·전환 메뉴는 `Menu`, 폼 값은 `Select`.

## 시간 표기

시간은 `apps/web/src/format/time.ts`의 `useTime()` 하나로 그린다(ADR 0010 7번). 진행 중인 것은 경과(`elapsed`, "25분째"), 지난 일은 상대 시간(`ago`, "방금"·"25분 전"·하루 넘으면 날짜), 타임라인은 시각(`clock`, "10:45"), 기다린 시간·통계 같은 양은 `duration`("12분")이다. 시각·날짜는 운영자 시간대(티켓 0044)로 그린다. "지금"은 서버가 데이터를 읽을 때 정해 경과 밀리초로 넘긴다.

## 새 컴포넌트를 더할 때

1. 동작은 `@ui-sdk/react`의 부품으로, 스타일은 StyleX와 토큰으로 `src/components/`에 만든다. UI SDK 상태별 스타일은 `className={(s) => cx(...)}`로 고른다(StyleX는 `data-*` 선택자를 쓰기 어렵다).
2. 문구는 props로 받는다. 기본 문구를 컴포넌트에 넣지 않는다.
3. `src/index.ts`에서 export 하고, `components.test.tsx`에 서버 렌더 테스트를, `/ds`(`apps/web/src/ds/`)에 미리보기를, 이 문서에 언제 쓰는지를 더한다.
4. UI SDK는 `0.1.0-beta`라 버전을 고정했다. 올릴 때는 `pnpm typecheck`(특히 `exactOptionalPropertyTypes`)와 `/ds`를 다시 확인한다.
