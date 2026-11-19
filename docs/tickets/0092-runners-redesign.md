---
status: done
blocked_by: []
---

# 0092 Runners 다시 그리기

## 목표

Runners 목록과 상세 패널을 시안 U8대로 다시 그려, 러너 상태·자리·공급자 사용량이 한눈에 읽히고 칸·라벨·숫자가 한 격자에 맞게 한다.

## 배경

운영자 평(2026-11-19): "지금 엉망이야 특히 공급자랑 러너 갯수 나타나는 곳". 목록이 화면 폭만큼 늘어나 열이 멀리 떨어졌고, 자리는 막대(`CapacityBar`)라 Dashboard의 칸(`CapacityCells`)과 모양이 달랐다. 사용량 열은 이름 아래 막대와 숫자가 붙어 이름과 숫자의 축이 어긋났다. 패널은 라벨·숫자·막대가 서로 다른 축에 있었고, 쓰지 않는 공급자를 접은 상자가 무거웠다.

## 운영자 결정(2026-11-19, 시안 U8)

- 목록은 최대 약 900px다. 열 머리는 "러너 / 자리 / 사용량(가장 높은 값)"이다.
- 행은 세 칸이다.
  - 왼쪽: 상태 알약 · 이름(굵게) · 호스트(고정폭, 흐리게). 아래 줄에 이유 한 줄. 문제 러너면 problem 색이다.
  - 가운데 자리: Dashboard와 같은 `CapacityCells`(칸 하나=자리 하나)와 "1/2". 지금의 `CapacityBar`는 없앤다.
  - 오른쪽 사용량: "Claude 5시간"과 "100%"를 한 줄(이름 왼쪽, 숫자 오른쪽), 그 아래 막대. 90% 이상 빨강. 사용량을 모르면 한 줄 글("사용량을 읽지 못했어요").
- 상세 패널 순서: 머리(상태·확인 시각·이름·호스트) → 문제 상자 → 자리(칸 + 지금 하는 런) → 공급자 사용량 → 확인 항목.
  - 공급자 사용량: 공급자 이름 아래 창마다 이름·막대·숫자 한 줄, 그 아래 초기화 시각. 로그인하지 않은 공급자와 쓰지 않는 공급자는 한 줄로 접는다. 계정 정보를 저장하지 않는다는 안내는 짧게.
  - 확인 항목: 상태 낱말 고정 폭 칸 + 항목, 머리에 "N/M 통과".
- 패널의 칸·라벨·숫자 정렬을 한 격자로 맞춘다.

## 범위

- **목록(`apps/web/src/runners/runners-screen.tsx`).** 목록 열을 `size.runnerListMaxWidth`(900px) 안에 둔다. 행 안 격자는 `minmax(0, 1fr) capacityCellsColumn(120px) usageColumn(200px)`이고 열 머리도 같은 격자를 쓴다. 목록 폭이 600px 밑이면(`breakpoints.responsiveColumnsStacked`, 컨테이너 쿼리) 열 머리를 숨기고 이름 칸을 한 줄 위에, 자리와 사용량을 그 아래 한 줄에 둔다.
- **패널.** 블록 제목 줄 오른쪽에 숫자·시각을 둔다: 자리 머리에 `CapacityCells`, 공급자 사용량 머리에 읽은 시각, 확인 항목 머리에 "N/M 통과", 남은 워크트리 머리에 개수. 창 이름과 확인 상태 낱말은 같은 폭(`size.panelLabelColumn`, 72px) 칸에 두고 막대·항목은 그 오른쪽에서 시작한다. 막대 끝의 %와 런 행의 경과 시간은 패널 오른쪽 끝에 맞춘다. 런·워크트리 행은 hover 면의 안쪽 여백만큼 밖으로 내어 글자가 블록 제목과 같은 왼쪽 선에서 시작한다. 100% 창은 초기화 시각이 아직 오지 않았으면 "한도에 닿았어요"를 초기화 시각 뒤에 붙인다.
- **`packages/ui`(새 컴포넌트와 토큰만 더한다).**
  - `UsageMeter`: 이름과 %를 한 줄 양 끝에, 막대를 그 아래에. `UsageBar`와 같은 Meter·색 규칙.
  - `PanelSection`: 제목 `h3`로 이름 붙은 `section`이고 `meta`를 제목 줄 끝에 둔다. `PanelRows`는 그 안 `Row` 목록을 Row 안쪽 여백만큼 밖으로 내어 글자를 블록 제목 선에 맞춘다.
  - `ResponsiveColumns`·`ResponsiveColumnsHead`: 앞 칸 + 고정 폭 칸 행과 그 열 머리. 컨테이너 폭 600·400에서 쌓는다. `Table`이 열을 인라인 style로 넣어 컨테이너 쿼리로 바꿀 수 없고, `table.tsx`는 함께 도는 0091이 고쳐 새 컴포넌트로 더했다(독립 리뷰 지적).
  - 토큰: `size.runnerListMaxWidth`, `size.capacityCellsColumn`, `size.panelLabelColumn`을 더하고 `size.usageColumn`을 200px로 바꿨다. Runners만 쓰던 `size.runnerStatusColumn`, `size.capacityColumn`은 지웠다. `breakpoints.responsiveColumnsStacked`를 더했다.
  - 함께 도는 0091이 고치는 목록·표·시간 칸 파일(`table.tsx` 등)은 고치지 않았다.
- **메시지(`apps/web/messages/ko/runners.json`).** 열 머리, 자리 이름, "N/M 통과", "한도에 닿았어요", 공급자 접은 줄, 짧은 계정 안내.

## 완료 조건

- 컴포넌트 시험: `UsageMeter`(이름·% 한 줄, 막대 아래, meter 이름·값), `PanelSection`(이름 붙은 section, meta 위치)(`packages/ui/src/components.test.tsx`).
- 화면 시험(`apps/web/src/runners/runners-screen.test.tsx`): 열 머리, 행의 자리 칸과 "n/m", 사용량 한 줄 + 막대, 읽지 못함 한 줄, 문제 이유 색, 패널 순서, 블록 머리의 읽은 시각·통과 수, 확인 상태 낱말 칸, 초기화 시각이 지난 100% 창.
- 쓰지 않는 공급자 이름은 접은 한 줄에 함께 쓴다("로그인하지 않았어요: Codex. 쓰지 않아요: Gemini 및 Antigravity"). 목록 폭이 600px 밑이라 열 머리를 숨기면 사용량 위에 "가장 높은 사용량"을 보인다. 확인 상태 낱말 unknown은 72px 칸에 맞게 "모르겠어요"로 줄였다.
- `/ds` 사용량 미리보기에 두 새 컴포넌트를 더했다(`page.test.tsx`가 내보내는 컴포넌트마다 미리보기를 요구한다, 코디네이터 허락).
- 브라우저 시험(`e2e/src/runners.test.ts`): 1280px에서 행의 세 칸이 열 머리와 같은 x에서 시작하고 목록이 900px를 넘지 않는다. 패널의 창 막대와 확인 항목 이름이 같은 x에서 시작한다. 400px에서 가로로 넘치지 않는다.
- 스크린숏: Runners 1728px·1280px 전·뒤(문제 러너·한도 러너·정상 러너가 함께), 좁은 폭(800px) 한 장.
- 마무리 리뷰: `better-interface`로 1728·1280·1100·800·400px을 띄워 리뷰하고 HIGH·MEDIUM을 고친다. 고친 뒤 `interface-review`로 Introduced·Regression이 0인지 확인한다. 두 리뷰의 표를 PR 본문에 붙인다.
