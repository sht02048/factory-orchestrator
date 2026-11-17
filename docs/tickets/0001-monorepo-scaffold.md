---
status: done
blocked_by: []
---

# 모노레포 뼈대와 품질 도구

## 목표

코드를 한 줄도 쓰기 전에 타입·린트·포맷·테스트가 pre-commit과 CI에서 강제되는 빈 모노레포를 만든다.

## 범위

- pnpm workspaces + Turborepo. 빈 패키지 `apps/web`, `apps/worker`, `packages/core`, `packages/db`, `packages/ui`
- Node 24 LTS 고정(`.nvmrc`, `engines`)
- TypeScript 7(`typescript@7`) 공용 `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `noPropertyAccessFromIndexSignature`
- oxlint type-aware 모드. `no-explicit-any`, `no-floating-promises`, `no-unsafe-*`, `switch-exhaustiveness-check`는 error
- oxfmt
- lefthook pre-commit: lint, format check, typecheck
- Vitest 설정과 예제 테스트 하나
- GitHub Actions: typecheck → lint → format check → test
- MIT 라이선스, README 초안
- main에 CI 필수 검사 branch protection(저장소는 이미 있다). 병합 방식은 머지 커밋만 허용
- `.agents/pr-gates.json`: CI와 독립 에이전트 리뷰를 게이트로 둔다

## 완료 조건

- 일부러 넣은 타입 오류·린트 오류·포맷 오류가 각각 pre-commit과 CI에서 실패한다
- 깨끗한 상태에서 CI가 통과한다
