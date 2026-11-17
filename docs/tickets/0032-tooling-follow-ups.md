---
status: todo
blocked_by: [0003]
---

# 0001 리뷰 후속: CI·도구 설정

## 목표

티켓 0001 PR 리뷰에서 막지 않는 항목으로 남긴 도구 문제를 고친다.

## 범위

- 이 티켓은 루트 설정(`.github/workflows/ci.yml`, `vitest.config.ts`, `lefthook.yml`, `pnpm-workspace.yaml`, `package.json`, 필요하면 새 `.npmrc`)만 고친다. 0003이 루트 설정을 고쳐서 0003 뒤에 한다.
- CI `concurrency`의 `cancel-in-progress`가 `main` push에도 걸려 연속 병합 때 앞 커밋의 CI가 취소된다. pull request에서만 취소한다.
- 0001 리뷰는 Vitest `include`가 `*.test.ts`만 잡는다고 지적했다. 0003이 Vitest를 패키지별 `projects`로 바꿨으니, `.test.tsx`가 잡히는지 확인하고 빠졌으면 더한다. 루트 `e2e/`는 0008이 더한다.
- `engines`가 `engine-strict` 없이 경고만 낸다. Node 24 밖에서 설치가 실패하게 한다. 이 저장소는 pnpm 설정을 `pnpm-workspace.yaml`에 두고 `packageManager`가 pnpm 12이므로, 그 버전이 이 설정을 어느 파일에서 읽는지 확인해 그곳에 둔다.
- lefthook 훅은 git 공통 hooks 폴더에 설치돼 모든 워크트리에서 돈다. `node_modules`가 없는 워크트리에서 훅이 알아보기 어려운 오류로 실패한다. `pnpm install`이 필요하다고 알리며 실패하게 한다(우회하지 않는다, AGENTS.md).

## 완료 조건

- `main` push 두 번을 잇달아 해도 앞 커밋의 CI가 취소되지 않는다(Actions 실행 기록으로 확인).
- `.test.tsx` 예제 파일이 `pnpm test`에서 돈다.
- Node 25로 `pnpm install`이 실패한다.
- `node_modules`가 없는 새 워크트리에서 커밋하면 훅이 `pnpm install` 안내와 함께 실패한다.
