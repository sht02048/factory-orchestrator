---
status: todo
blocked_by: [0007]
---

# web Runners 화면

## 목표

러너마다 연결 상태, capacity 사용량, 남은 워크트리를 본다.

## 범위

- 이 티켓은 `apps/web`의 Runners 라우트와 그 화면 메시지만 고친다.
- Online/Offline과 마지막 확인 시각, capacity 사용량(Disconnected 런 포함, Q74), capacity를 쓰는 런과 그 Workspace(Disconnected 런은 "연결 끊김"으로), 기다리는 런, 러너 쪽 프로젝트, orca 경로(시안 B).
- 남은 워크트리 수(Human Check, PR 열린 시간 초과·입력 기다리다 멈춤·운영자가 취소함 런, 사람이 지워야 할 러너 연결 끊김 런, Q44·Q51·Q75).
- Runners는 Workspace와 상관없는 공용 화면이다(ADR 0006).

## 완료 조건

- 테스트 DB의 러너·런(Disconnected 런, 러너 연결 끊김 런 포함)으로 capacity 사용량과 남은 워크트리 수가 맞게 보인다는 테스트가 통과한다.
- Workspace를 바꿔도 러너 목록이 같다는 테스트가 통과한다.
