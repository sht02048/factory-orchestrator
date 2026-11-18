---
status: todo
blocked_by: [0049a]
---

# 0049d Runners + 온보딩

묶음 티켓 [0049](0049-ui-redesign.md)의 하위 티켓이다. [0049a](0049a-ui-base.md)의 토큰·`StatusPill`·`Card`·`useTime()`을 쓴다.

## 범위

- **Runners.** 러너 카드(Online·Offline 알약, capacity 막대 "2/2", 문제가 있으면 해결 안내).
- **온보딩.** 왼쪽 단계 목록(Tracker·GitHub·Runner·Workspace·Mapping) · 가운데 입력 · 확인 결과. 단계 이름은 메시지 파일에 영어 이름으로 둔다(지금은 "트래커를 연결해요" 같은 문장만 있다). 단계는 모두 필수이고 확인이 성공해야 다음으로 간다(그대로).

## 완료 조건

- Runners·온보딩에 파란 주 버튼이 하나 이하라는 시험.
- 온보딩 단계 이름 메시지가 Tracker·GitHub·Runner·Workspace·Mapping이라는 시험.
- `pnpm dev`(온보딩은 `pnpm dev --onboarding`)로 띄운 스크린숏을 PR에 붙인다.
