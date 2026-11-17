# Factory Orchestrator

Software factory의 관제탑. 트래커의 티켓을 러너에 맡기고, 러너의 에이전트가 티켓을 처리한 현황과 통계를 보여 준다. 용어는 [`GLOSSARY.md`](./GLOSSARY.md), 주요 결정은 [`docs/adr/`](./docs/adr/)에 있다.

## 구조

| 경로            | 역할                                                        |
| --------------- | ----------------------------------------------------------- |
| `apps/web`      | 화면, server function, Linear webhook 수신 (TanStack Start) |
| `apps/worker`   | 할당 큐, 러너 명령, 런·PR 상태 폴링을 맡는 상시 데몬        |
| `packages/core` | 도메인 로직                                                 |
| `packages/db`   | SQLite(WAL) 스키마와 접근                                   |
| `packages/ui`   | 디자인 시스템 (StyleX + UI SDK)                             |

지금은 품질 도구만 갖춘 빈 패키지다.

## 시작하기

Node 24 LTS와 `package.json`의 `packageManager`에 적힌 pnpm이 필요하다.

```sh
nvm use
pnpm install   # lefthook pre-commit 훅도 함께 설치된다
```

## 명령

| 명령                | 하는 일                                  |
| ------------------- | ---------------------------------------- |
| `pnpm typecheck`    | TypeScript 7(`tsc`)으로 모든 패키지 검사 |
| `pnpm lint`         | oxlint type-aware 린트                   |
| `pnpm format`       | oxfmt로 포맷                             |
| `pnpm format:check` | 포맷 검사                                |
| `pnpm test`         | Vitest 실행                              |

pre-commit 훅은 lint, format check, typecheck를 돌린다. CI(GitHub Actions)는 pull request와 `main` push에서 typecheck → lint → format check → test 순으로 돈다.

## 일감

트래커 대신 [`docs/tickets/`](./docs/tickets/)의 로컬 티켓으로 관리한다.

## 라이선스

[MIT](./LICENSE)
