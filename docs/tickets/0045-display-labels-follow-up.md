---
status: todo
blocked_by: []
---

# 러너 확인 항목과 에이전트 이름 표시

## 목표

러너 확인 항목과 에이전트 이름을 메시지 파일의 문구로 보인다(ADR 0005).

## 배경

완료 기준 시험(research [0011](../research/0011-acceptance-run.md))에서 두 가지를 봤다.

- 온보딩 러너 단계와 Runners 화면에 러너 확인 항목 이름이 영어로 보였다("Orca background service", "GitHub push access: <프로젝트>"). 러너 어댑터(packages/runner-orca `orca-runner.ts`)가 만든 `name`·`hint` 문자열을 그대로 그린다. GitHub push 항목의 안내(`hint`)도 영어다.
- 에이전트가 Mapping에서는 "Claude Code"로 보이지만 홈·Runs·Run 상세에서는 ID `claude`로 보인다(Stats는 확인하지 않았다).

## 범위

- 러너 확인 항목은 `id`의 종류(`orca-service`, `github-push:<프로젝트>`)로 web 메시지를 골라 그리고, 모르는 종류만 어댑터 문자열로 보인다. 어댑터 문자열은 바꾸지 않는다(다른 화면이 없는 러너 어댑터도 있다, ADR 0008).
- 에이전트 이름은 Settings의 에이전트 메시지(`settings.json`의 에이전트 이름)를 공용 메시지로 옮겨 모든 화면이 같이 쓴다. 모르는 에이전트 ID는 ID 그대로 보인다.

## 완료 조건

- 러너 확인 항목 `orca-service`와 `github-push:*`가 한국어 메시지로 보인다는 테스트가 통과한다.
- 홈·Runs·Run 상세에서 에이전트 `claude`가 "Claude Code"로 보인다는 테스트가 통과한다.
