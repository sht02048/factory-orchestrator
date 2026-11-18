---
status: todo
blocked_by: []
---

# 0067 공용 Button aria 속성과 Stats 묶음 표 좁은 폭

## 목표

0051~0053이 우회한 공용 `Button`의 빈틈을 메우고, Stats 묶음 표가 중간 폭에서 깨지지 않게 한다.

## 배경

- `packages/ui`의 `Button`이 `aria-expanded`, `aria-describedby`, `aria-disabled`를 받지 않는다. 그래서 0051(Run 상세 "새로 받기"), 0052(온보딩 "다음"), 0053(Stats "표로 보기")이 `buttonStyles`를 입힌 HTML 기본 `<button>`을 대신 썼다.
- Stats 묶음 표는 창 폭 1044~1199px(목록 폭 576~731px)에서 이름 열이 0~132px로 줄어든다. 고정 열 폭 합이 크다(0056 보고). 908px 아래는 0056의 SplitView 쌓기로 풀렸다.

## 범위

- `ButtonProps`에 세 aria 속성을 더하고, 세 화면의 기본 `<button>`을 공용 `Button`으로 되돌린다.
- Stats 묶음 표의 열 폭을 고쳐 이름 열이 읽을 수 있는 폭(최소 120px 안팎)을 지키게 한다. 좁으면 덜 중요한 열을 숨기거나 표를 가로 스크롤 상자에 넣는다.

## 완료 조건

- 세 화면에서 기본 `<button>`이 사라지고 공용 `Button`의 aria 속성 시험이 통과한다.
- 1044px·1100px 창 폭의 Stats 스크린숏을 PR에 붙인다.
