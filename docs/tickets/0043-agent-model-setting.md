---
status: done
blocked_by: []
---

# 에이전트 모델을 화면에서 정하기

## 목표

운영자가 런에 쓸 에이전트 모델을 오케스트레이터 화면에서 정할 수 있게 한다.

## 배경

러너 어댑터 설정에는 에이전트 모델(`model`, 없으면 러너 Orca 설정을 따름, `worker-start --model`)이 있지만(packages/runner-orca `config.ts`), Settings와 온보딩의 러너 폼에는 이름·capacity·ssh 대상·orca 경로만 있다. 완료 기준 시험(research [0011](../research/0011-acceptance-run.md))에서는 가벼운 모델로 돌리려고 DB의 러너 설정에 `model`을 직접 넣었다.

## 범위

- 모델은 Mapping마다 둔다(아래 운영자 결정). `apps/web`의 Mapping 폼(온보딩·Settings)과 메시지, `packages/core`·`packages/db`(마이그레이션 `mapping_model`)·`packages/runner-orca`·`apps/worker`를 고친다.
- 할당 때 Mapping의 모델을 런에 옮겨 적고, 시작할 때 `worker-start --model`로 넘긴다. 우선순위는 런의 모델(Mapping 값) → 러너 설정의 `model` → 러너 Orca의 기본값이다(스펙 3절 4번).
- 수동 할당에서 운영자가 에이전트를 바꾸면 Mapping의 모델은 다른 에이전트의 모델 이름이라 런에 적지 않는다.
- Run 상세에 런의 모델을 보인다. 같은 Mapping이라도 모델을 바꾸면 런마다 쓴 모델이 다를 수 있어서다.

## 완료 조건

- 화면에서 정한 모델이 `worker-start --model`로 넘어간다는 테스트가 통과한다.
- 비워 두면 `--model`을 넘기지 않는다는 테스트가 통과한다.

## 운영자 결정(2026-11-18)

- 에이전트 모델은 Mapping마다 둔다. 선택 칸이고 비우면 러너 Orca 기본값(`--model`을 넘기지 않음)이다. 같은 러너에서 에이전트마다 모델 이름이 다르기 때문이다. 온보딩 Mapping 단계와 Settings Mapping 폼 둘 다에 둔다.
- 수동 할당 창에서는 바꾸지 않는다(기존 규칙대로 러너·에이전트만 바꿈).
- 러너 설정의 `model`은 남기되 Mapping 값이 있으면 그것이 이긴다.
- 런에는 쓴 모델을 기록한다.
