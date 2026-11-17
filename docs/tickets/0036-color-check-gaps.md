---
status: done
blocked_by: [0003]
---

# 색 리터럴 검사의 빈틈과 오탐 보강

## 목표

0003의 색 리터럴 검사가 놓치는 경우와 잘못 잡는 경우를 고쳐, `packages/ui` 밖의 색 값이 빠짐없이 막히고 색이 아닌 값은 통과하게 한다.

## 범위

- 이 티켓은 `scripts/check-color-literals.ts`와 그 테스트만 고친다.
- 놓치는 것: JSX 속성(`fill="red"` 등), 삼항식의 앞 분기, gradient 안의 이름 색.
- 잘못 잡는 것: `'gold'`처럼 색 이름과 같지만 색이 아닌 값.

## 완료 조건

- 위 세 빈틈과 오탐마다 실패하던 테스트가 추가되고 통과한다.
- `pnpm run check:colors`가 지금 저장소에서 통과한다.
