---
status: todo
blocked_by: [0069, 0070, 0071, 0072, 0073, 0080]
---

# 0074 디자인 시스템 사용을 검사로 강제

## 목표

화면이 디자인 시스템을 우회하지 못하게 검사를 켜고, 남은 우회를 옮긴다.

## 배경

색은 `check:colors` 검사가 있어 화면에 색 값을 직접 쓴 곳이 0이다. 검사가 없는 글자·여백·면은 지켜지지 않았다(0073 배경의 숫자). 문서 규칙만으로는 지켜지지 않는다.

## 범위

1. **토큰 import 막기**: `apps/web`에서 `@factory/ui/tokens.stylex`의 colors, fontSize, fontWeight, lineHeight, letterSpacing, radius, shadow, motion을 가져오면 실패한다. oxlint `no-restricted-imports`가 이 설정을 지원하는지 먼저 확인하고, 안 되면 `scripts/`의 검사 스크립트로 한다(`check:colors`와 같은 방식). `space`, `size`는 허용한다.
2. **px 숫자 막기**: `apps/web` 스타일에서 여백·간격·둥글기·폭에 px 숫자를 쓰면 실패한다. 배치에 꼭 필요한 값은 `size` 토큰으로 올린다.
3. **HTML 요소 막기**: `apps/web`에서 `button`, `input`, `select`, `textarea`, `table`, `h1`~`h3`을 직접 쓰면 실패한다(oxlint `react/forbid-elements` 지원 여부 확인, 안 되면 검사 스크립트). 공용 컴포넌트에 없는 속성이 필요하면 `packages/ui`를 넓힌다(0067의 Button aria 속성을 여기서 함께 끝낸다).
4. **옮기기**: 0069~0072가 다시 짠 네 화면 밖(온보딩, Run 상세, Runs, Settings, 셸, 할당 대화상자 등)의 우회를 새 역할·컴포넌트로 옮긴다. 기존 `Text` 변형 중 새 역할과 겹치는 것을 정리한다.
5. **검사 연결**: 새 검사를 `package.json` 스크립트, lefthook pre-commit, CI `check`, AGENTS.md CI 설명에 더한다.
6. **리뷰 게이트**: `.agents/pr-gates.json` 독립 리뷰 지시에 "DESIGN.md의 역할·컴포넌트를 쓰는지, 공용 컴포넌트를 우회하지 않는지"를 막는 항목으로 더한다.
7. **`/ds` 빠짐 시험**: `packages/ui`가 내보내는 컴포넌트마다 `/ds` 미리보기가 있는지 확인하는 시험을 더한다.

## 완료 조건

- 세 검사가 `apps/web`에서 0건으로 통과하고, 일부러 어긴 예시에서 실패한다는 시험.
- 옮긴 화면의 기존 시험이 통과하고, 바뀐 화면의 스크린숏을 PR에 붙인다.
