---
status: todo
blocked_by: []
---

# 에이전트 모델을 화면에서 정하기

## 목표

운영자가 런에 쓸 에이전트 모델을 오케스트레이터 화면에서 정할 수 있게 한다.

## 배경

러너 어댑터 설정에는 에이전트 모델(`model`, 없으면 러너 Orca 설정을 따름, `worker-start --model`)이 있지만(packages/runner-orca `config.ts`), Settings와 온보딩의 러너 폼에는 이름·capacity·ssh 대상·orca 경로만 있다. 완료 기준 시험(research [0011](../research/0011-acceptance-run.md))에서는 가벼운 모델로 돌리려고 DB의 러너 설정에 `model`을 직접 넣었다.

## 범위

- 모델을 어디에 둘지(러너마다, Mapping마다, 에이전트마다) 정해야 한다. 지금 설정은 러너마다이지만, 같은 러너에서 Claude Code와 Codex를 함께 쓰면 모델 이름이 에이전트마다 다르다. 운영자 결정 전에는 정하지 않는다.
- 결정에 따라 `apps/web` 폼과 메시지, 필요하면 `packages/core`·`packages/db`·`packages/runner-orca`를 고친다.

## 완료 조건

- 화면에서 정한 모델이 `worker-start --model`로 넘어간다는 테스트가 통과한다.
- 비워 두면 `--model`을 넘기지 않는다는 테스트가 통과한다.

## 운영자 결정 필요

- 모델을 러너, Mapping, 에이전트 중 어디에 둘지.
