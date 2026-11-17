---
status: done
blocked_by: [0007]
---

# web Runners 화면

## 목표

러너마다 연결 상태, capacity 사용량, 남은 워크트리를 본다.

## 범위

- 이 티켓은 `apps/web`의 Runners 라우트와 그 화면 메시지만 고친다.
- Online/Offline과 마지막 확인 시각, capacity 사용량(Disconnected 런 포함, Q74), capacity를 쓰는 런과 그 Workspace(Disconnected 런은 "연결 끊김"으로), 기다리는 런, 러너 쪽 프로젝트, orca 경로(시안 B).
- 남은 워크트리 수: 요약 계산 함수의 워크트리 처리가 "PR이 병합되거나 닫힐 때까지 남김"이거나 "사람이 정함"이고 아직 지운 시각이 없는 런. Queued에서 취소한 런은 넣지 않는다(Q44·Q51·Q75·Q77, CODING_STANDARDS 「요약 결과는 계산 함수 하나로만 정한다」).
- 후속(Q82, 이 티켓을 닫은 뒤 정함): 러너의 GitHub 인증 결과와 깨졌을 때 할당에서 빠졌다는 표시(Q82.14·Q82.15), 러너에 닿지 못한 채 끝난 취소 런을 남은 워크트리 수에 넣기(Q82.21)는 0037 뒤 후속 티켓에서 반영한다.
- Runners는 Workspace와 상관없는 공용 화면이다(ADR 0006).

## 완료 조건

- 테스트 DB의 러너·런(Disconnected 런, 러너 연결 끊김 런 포함)으로 capacity 사용량과 남은 워크트리 수가 맞게 보인다는 테스트가 통과한다.
- Workspace를 바꿔도 러너 목록이 같다는 테스트가 통과한다.
