---
status: todo
blocked_by: [0077]
---

# 0080 앱 화면에 Ganger 브랜드 색 입히기

## 목표

0077에서 정한 브랜드 세 색(Ink·Paper·Ganger Yellow)을 앱 화면 전체에 적극적으로 쓰고, 나머지 팔레트를 세 색에 어울리게 다시 맞춘다. 배경·면은 Ink, 글자는 Paper, 강조색은 Ganger Yellow다.

## 배경

0077 브랜드 시트는 앱 화면을 그대로 두고 노랑을 로고·마스코트 그림에만 쓰기로 했다. 노랑이 Human Check 상태 색(ADR 0010 5번)이라서다. 운영자는 2026-11-18에 브랜딩대로 앱 화면 전반을 바꾸기로 하고, 노랑을 강조색으로 쓰는 쪽을 골랐다. 그러려면 Human Check가 노랑을 내놓아야 한다.

ADR 0010은 예전 Human Check 주황이 Failed 빨강과 가까워 헷갈렸다는 점을 색 규칙의 근거로 적었다. 그래서 Human Check의 새 색은 빨강(Failed)·보라(Question·Permission)·초록(Running)·파랑(Merged)·회색과 모두 갈려야 한다. 후보는 청록(hue 약 195)이다. 주황을 쓰려면 Failed 빨강과 밝기·색상 차이를 시험으로 보여야 한다.

## 범위

- **세 색을 축으로 팔레트를 다시 짠다(`packages/ui/src/tokens.stylex.ts`)**
  - **Ink**(`oklch(0.14 0 0)`): `bgCanvas`를 Ink로 두고 `bg*`·`border*`를 Ink에서 밝기만 올린 단계로 만든다. 지금 캔버스보다 어두운 `bgInset`·`backdrop`은 Ink보다 한 단계 어둡게 두어 지금의 밝기 관계(캔버스보다 어두움)를 지킨다. 지금의 푸른 기(hue 260)는 뺀다.
  - **Paper**(`oklch(0.97 0.003 85)`): `textPrimary`를 Paper로 두고 `textSecondary`·`textTertiary`·`textDisabled`를 Paper의 따뜻한 무채색에서 밝기만 내린 단계로 만든다.
  - **Ganger Yellow**(`oklch(0.84 0.15 75)`): `accent`·`accentHover`·`accentText`·`accentSoft`를 노랑 계열로 바꾸고, 주 버튼·링크·선택 행·포커스 링·레일 선택 표시·탭 선택에 쓴다. 노랑 바탕 위 글자는 Ink(`textOnAccent`)다.
  - **상태 색**은 세 색 옆에서 어울리게 다시 맞춘다. 채도·밝기를 한 단계 묶음(예: 같은 밝기, 비슷한 채도)으로 고르고, 노랑 강조색과 갈리게 한다. `check`·`checkSoft`(Human Check)는 노랑을 내놓는다.
  - 0077의 브랜드 그림 토큰(Ganger Yellow)과 강조색이 같은 값을 쓰게 하나로 모은다.
- **ADR 0010 갱신**: 5번 색 표(Human Check 새 색, 강조색 노랑), 6번 규칙 이름 "파란 주 버튼", Dashboard 묶음 설명의 "확인해 주세요(Human Check, 노랑)", 근거의 "색 의미 겹침 해소" 문장, "포인트 파랑은 둘에 쓰인다"(이제 파랑은 Merged만), 0077이 더한 브랜드 그림 색 예외(강조색 규칙으로 바꾼다)를 고친다. 0077의 "마스코트를 상태 표시 곁에 두지 않는다"는 화면이 장난스러워지지 않게 하는 규칙으로 그대로 둔다.
- **색 이름이 들어간 곳**: "파란 주 버튼"을 이름에 쓴 시험(apps/web/src 의 여러 화면 시험, e2e/src/home.test.ts), `/ds` 미리보기 문구(apps/web/messages/ko/ds.json 의 "노랑 · 사람이 확인" 등), `packages/ui/DESIGN.md`의 주 버튼(accent) 근거 문장을 새 색에 맞춰 고친다.
- **`tokens.test.ts`**: "merged와 accent 밝기 차" 시험은 accent가 노랑이 되면 뜻이 없으므로 "상태 색과 accent 가 hue 40° 이상 떨어진다" 시험으로 바꾼다. 상태 색끼리의 hue 거리 시험(≥40°)을 유지하고 accent 를 비교 대상에 넣는다. `scripts/check-color-literals.ts`도 새 규칙에 맞춘다.
- **화면 확인**: 토큰 값만 바꾸는 것이 원칙이다. 노랑 강조색에서 읽기 어려운 자리(링크 글자, 선택 행, 포커스 링, 주 버튼, 레일 선택 표시)를 모든 화면에서 확인하고, 고칠 곳은 컴포넌트에서 고친다. 레일 기호는 이제 노란 취구가 있는 기본판을 써도 된다.
- 0078(이름 바꾸기)·0074(검사 강제)와 겹치지 않게 토큰·컴포넌트·ADR만 고치고 화면 구조는 바꾸지 않는다.

## 완료 조건

- 강조색·Human Check·배경 값이 바뀐 토큰 시험, 노랑 위 글자와 노랑 링크 글자의 대비 시험(WCAG AA), Human Check 새 색이 다른 상태 색·강조색과 hue 40° 이상 떨어진다는 시험(청록 hue 195 는 초록 150·파랑 245 와 45°·50° 라 기준을 넘지만 여유가 작으니, 밝기 차도 함께 본다).
- Dashboard·Tickets·Runs·Runners·Stats·Settings·온보딩 1280px 스크린숏(바꾸기 전·뒤)을 PR에 붙인다.
