---
status: done
blocked_by: []
---

# 온보딩에서 Auto-assign Label과 "In Progress" 상태 정하기

## 목표

온보딩만 마친 설치에서 라벨을 붙이는 것만으로 할당되고, 런이 시작하면 티켓이 "In Progress"가 되게 한다(스펙 1절 완료 기준, 3절 2·8번).

## 배경

완료 기준 시험(research [0011](../research/0011-acceptance-run.md))에서 온보딩 다섯 단계를 마친 뒤 Settings에 Auto-assign Label과 "In Progress" 상태가 둘 다 0/1로 비어 있었다. 온보딩은 둘을 묻지 않고, 홈도 비었다고 알리지 않는다. 그대로 라벨을 붙이면 할당되지 않고(라벨이 없으면 자동 할당이 없다), worker는 "In Progress"를 고르지 않았으면 티켓 상태를 바꾸지 않는다(`markInProgress`). 시험은 Settings에서 둘을 골라 진행했다.

## 범위

- 이 티켓은 `apps/web`의 온보딩 화면과 메시지만 고친다. 입력 폼과 저장은 Settings(0025)의 것을 다시 쓴다.
- Mapping 단계(또는 그 뒤 한 단계)에서 트래커 연결의 Auto-assign Label과 트래커 프로젝트의 "In Progress" 상태를 고른다.
- 두 값은 필수다(아래 운영자 결정). Mapping, "In Progress" 상태, Auto-assign Label을 모두 정한 트래커 프로젝트가 하나 이상이어야 온보딩을 마친다. 빠진 것과 그 결과(라벨로 할당되지 않음, 티켓 상태를 바꾸지 않음)를 화면에 보인다.

## 완료 조건

- 온보딩에서 Auto-assign Label과 "In Progress" 상태를 골라 저장하면 Settings에 1/1로 보인다는 테스트가 통과한다.
- 둘 중 하나라도 비워 두면 온보딩을 마칠 수 없고, 빠진 것을 안내한다는 테스트가 통과한다.

## 운영자 결정(2026-11-18)

- 온보딩 Mapping 단계에서 트래커 연결의 Auto-assign Label과 트래커 프로젝트의 "In Progress" 상태를 필수로 고른다(스펙 3절 1번 "모든 단계가 필수"와 맞춤). 고르지 않으면 온보딩을 마칠 수 없다. 입력·저장은 Settings 것을 다시 쓴다.
