---
status: done
blocked_by: [0049a]
---

# 0049e Tickets·Stats·Settings 규칙 맞추기

묶음 티켓 [0049](0049-ui-redesign.md)의 하위 티켓이다. 구조는 그대로 두고 ADR 0010의 규칙(상태 알약, 제목 + 요약 한 줄, 티켓 표기, 둥글기, 버튼 위계, 시간 표기)을 맞춘다.

## 범위

- **시간 표기.** Tickets 런 이력의 할당 시각과 Settings 러너 확인 시각을 `useTime().ago`로 바꾼다. 두 화면의 데이터에 서버가 읽은 때(또는 지난 밀리초)를 담아야 한다(0049a가 남긴 것). 바꾸면 `apps/web`에서 `useFormatter().dateTime`을 쓰는 곳이 없어야 한다.
- **티켓 표기.** 어디서나 회색 키 + 제목.
- **버튼 위계.** 화면 전체에 파란 주 버튼 하나. Settings 편집 영역의 저장·확인 버튼과 위험 행동(지우기, 연결 끊기)을 `danger`로.

## 완료 조건

- Tickets·Stats·Settings에 파란 주 버튼이 하나 이하라는 시험.
- 앱 코드가 `useTime()` 밖에서 시각·날짜를 만들지 않는다는 시험.
- `pnpm dev`로 띄운 Tickets·Stats·Settings 스크린숏을 PR에 붙인다.
