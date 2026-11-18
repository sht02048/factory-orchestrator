---
status: todo
blocked_by: [0049a]
---

# 0049b 레일 셸 + Home

묶음 티켓 [0049](0049-ui-redesign.md)의 하위 티켓이다. [0049a](0049a-ui-base.md)의 토큰·`StatusPill`·`Card`·`Row`·`useTime()`을 쓴다.

## 범위

- **레일 셸**(ADR 0010 11번). 왼쪽 아이콘 레일: 맨 위 Workspace 바꾸기, 메뉴 Home·Tickets·Runs·Runners·Stats, 맨 아래 Settings. Runners 아이콘에 Runner Issue 개수 점. 셸과 겹치는 루트 레이아웃은 이 티켓이 맡는다.
- **Home.** 손댈 일 카드(종류 알약, 회색 키 + 제목, 설명 문장, 보조 버튼 행동) + 오른쪽 "지금 일어나는 일" 흐름(DB에 있는 사건만, ADR 0010 Consequences). 제목 "Home" + 한 줄 요약.
- **Runner Issue에 Offline 러너를 올린다.** 지금은 GitHub 인증이 깨진 러너만 손댈 일에 오른다.

## 완료 조건

- Home의 카드 행동과 질문 선택지가 모두 보조 버튼이고, 화면 전체에 파란 주 버튼이 하나 이하라는 시험.
- Offline 러너가 손댈 일에 Runner Issue로 오르고 Runners 아이콘 점 개수에 든다는 시험.
- Home의 상태 알약 글이 영어 용어 안에 있다는 시험(0049a의 `pillsOf`를 쓴다).
- `pnpm dev`로 띄운 Home 스크린숏을 PR에 붙인다.
