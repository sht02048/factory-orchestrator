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

`packages/ui`에는 디자인 시스템(토큰, 컴포넌트, 쓰는 규칙 [`packages/ui/DESIGN.md`](./packages/ui/DESIGN.md))이 있다. `apps/web`은 아직 디자인 시스템 미리보기(`/ds`)만 있고, 나머지 패키지는 비어 있다.

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
| `pnpm check:colors` | `packages/ui` 밖의 색 값 직접 사용 검사  |
| `pnpm build`        | 웹 앱 프로덕션 빌드                      |

웹 앱은 `pnpm --filter @factory/web dev`로 띄우고 `http://127.0.0.1:3000/ds`에서 디자인 시스템을 본다. 프로덕션 빌드는 `pnpm --filter @factory/web start`로 실행하고, 기본으로 `127.0.0.1`에만 바인딩한다. 바꾸려면 셸 환경 변수 `WEB_HOST`, `WEB_PORT`를 준다(예: `WEB_PORT=4000 pnpm --filter @factory/web start`).

pre-commit 훅은 lint, format check, typecheck, 색 리터럴 검사를 돌린다. CI(GitHub Actions)는 pull request와 `main` push에서 typecheck → lint → 색 리터럴 검사 → format check → test → build 순으로 돈다.

## 셀프호스팅

> 아직 실행할 기능이 없다. 기능이 생기면 이 절을 채운다.

오케스트레이터는 운영자 한 사람이 자기 머신에서 띄워 쓰는 도구다. 큰 흐름은 이렇게 잡혀 있다.

- `apps/web`과 `apps/worker`를 같은 머신에서 띄우고, 둘이 SQLite 파일 하나를 공유한다.
- 러너는 오케스트레이터가 ssh로 닿을 수 있는 Orca 환경이다.
- 호스트, 포트, 토큰 같은 환경 값은 모두 `.env`로 받는다. [`.env.example`](./.env.example)을 `.env`로 복사해 자기 값으로 바꾼다.

## 일감

트래커 대신 [`docs/tickets/`](./docs/tickets/)의 로컬 티켓으로 관리한다.

## 라이선스

[MIT](./LICENSE)
