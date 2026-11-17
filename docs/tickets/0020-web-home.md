---
status: todo
blocked_by: [0007]
---

# web 홈 화면

## 목표

현재 Workspace에서 손댈 일, 실행 중, Queued를 한눈에 본다.

## 범위

- 이 티켓은 `apps/web`의 홈 라우트와 그 화면 메시지만 고친다. 앱 셸은 고치지 않는다(0007).
- 손댈 일: Human Check, Failed, Waiting for Input 런과 이유 한 줄(Q52). 실행 중: Running. Queued: 들어온 순서.
- "전체" Workspace에서는 모든 Workspace의 손댈 일만 보인다(ADR 0006).
- 목록 + 오른쪽 상세 패널(ADR 0007, 시안 B).

## 완료 조건

- 테스트 DB의 런이 세 구역에 맞게 나뉘고, Queued가 들어온 순서로 보인다는 테스트가 통과한다.
- Waiting for Input 런이 손댈 일에 "입력 기다림"으로 보인다는 테스트가 통과한다.
- "전체"에서 손댈 일만 보인다는 테스트가 통과한다.
