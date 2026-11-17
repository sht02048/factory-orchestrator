---
status: todo
blocked_by: [0017]
---

# worker 자동 할당과 폴링 보정

## 목표

Auto-assign Label이 붙은 티켓을 사람 없이 할당한다.

## 범위

- 이 티켓은 `apps/worker`만 고친다.
- web이 DB에 기록한 webhook 이벤트를 읽어 할당 조건(core)에 맞으면 db의 할당 진입점(0005)으로 런을 만든다. `Linear-Delivery`로 이미 처리한 이벤트는 건너뛴다.
- 폴링 보정: 주기적으로 라벨이 붙은 티켓을 조회해 놓친 할당을 맞춘다(ADR 0001).
- 러너 고르기: 시작할 때 core 규칙(러너 쪽 프로젝트가 있는 Online 러너 중 남은 capacity가 가장 많은 러너)을 쓴다(Q53). 수동 할당에서 운영자가 고른 러너는 그대로 쓴다(Q60).
- 티켓이 속한 트래커 프로젝트의 Workspace와 Mapping을 찾는다. Mapping이 없으면 할당하지 않고 이유를 남긴다.

## 완료 조건

- 같은 webhook 이벤트가 두 번 와도 런이 하나만 생긴다는 테스트가 통과한다.
- webhook을 놓쳐도 폴링 보정으로 런이 생긴다는 테스트가 통과한다.
- 러너 셋(Offline 하나, capacity가 다른 Online 둘) 중 맞는 러너가 골라진다는 테스트가 통과한다.
