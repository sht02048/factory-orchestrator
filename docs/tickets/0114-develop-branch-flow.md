---
status: done
blocked_by: []
---

# 0114 develop 브랜치 흐름과 hotfix

## 목표

기능 작업은 `develop`에 모으고, 출시할 때와 hotfix 때만 `main`에 머지한다. `main`에 머지되면 지금처럼 자동으로 릴리스된다. 결정과 이유는 [ADR 0017](../adr/0017-develop-branch-flow.md)에 있다.

## 배경

0087의 자동 릴리스는 `main`에 버전이 바뀐 PR이 머지되면 태그와 Release를 만든다. 기능 PR도 모두 `main`으로 가서, `main`이 늘 출시 직전 상태가 아니었다. 운영자와 정했다(2026-11-19).

- 기능 작업의 베이스는 `develop`이다. `develop`이 저장소 기본 브랜치가 된다.
- 출시할 때만 `develop` → `main`으로 PR을 올린다. `main`에 머지되면 자동으로 릴리스된다(Tag release → `release.yml` 그대로).
- hotfix는 `main`에서 `hotfix/*`를 따서 `main`으로 바로 PR한다. 머지되면 역시 자동 릴리스.
- `develop`은 언제나 `main`의 모든 커밋을 담는다. `main`에 무엇이 머지되든 `main`을 `develop`으로 바로 다시 합친다.

## 범위

- `scripts/branch-flow.ts`: Prepare release의 `source` 입력 검사(`develop` 또는 `hotfix/*`만)와, `main`으로 가는 PR 검사(head가 같은 저장소의 `release/*`·`hotfix/*`이고 최신 `main`을 담는지, `develop`이 없으면 건너뜀).
- `scripts/release-version.ts`: `bump <version> [directory]`. 워크플로가 믿는 쪽 스크립트로 다른 체크아웃의 버전을 올릴 수 있게 한다.
- Prepare release: `develop`에서 돈다. 입력 `source`(기본 `develop`). `develop`이면 `release/v<version>`을 따 버전을 올리고 `main`으로 PR을 연다. `hotfix/*`면 그 브랜치에 버전 커밋을 더하고 `main`으로 가는 PR을 쓰거나 연다. hotfix 브랜치의 코드는 실행하지 않는다.
- Tag release: 그대로 둔다. 버전이 안 바뀐 hotfix 머지는 태그를 만들지 않는다.
- Sync develop(새 워크플로): `main` push마다 앱 토큰으로 GitHub merges API를 불러 `main`을 `develop`에 머지 커밋으로 합친다. 충돌이면 `sync/main-to-develop` 브랜치와 `develop`으로 가는 PR을 연다. `develop`이 없으면 건너뛴다.
- CI: `develop` push에서도 `check`를 돌린다. `main`으로 가는 PR은 새 워크플로 `main-pr.yml`의 잡 `main-pr`이 본다. 베이스를 `main`으로 바꾸는 `edited`에도 돈다.
- 문서: AGENTS.md 작업 흐름, README 릴리스 절, 0087 메모, ADR 0005 갱신 단락, 새 ADR 0017.

## 운영자 설정(이 PR 머지 뒤, 코디네이터가 gh API로 한다)

README "Automatic releases" 절의 8단계와 앱 권한·environment 단계에 적었다. 요약:

1. `main`에서 `develop` 브랜치를 만들고 기본 브랜치로 바꾼다.
2. 앱 권한에 Workflows read and write를 더하고 설치에서 승인한다(Sync develop이 워크플로 파일이 바뀐 `main`을 합칠 때 필요).
3. `release-bot` environment의 배포 브랜치에 `develop`을 더한다(Prepare release가 `develop`에서 돈다).
4. `develop` 보호 ruleset: PR 필수, required check `check`, force push·삭제 금지, bypass에 앱.
5. `main`의 required check에 `main-pr`을 더하고 branches up to date를 켠다.

## 완료 조건

- `scripts/branch-flow.test.ts`가 source 검사(develop·hotfix 허용, 그 밖 거절, 위험한 이름 거절)와 `main` PR 판정(develop 없음·다른 베이스·release·hotfix·다른 브랜치·포크·최신 main 미포함)을 시험한다.
- `actionlint`가 `.github/workflows/*.yml`에서 아무것도 찾지 않는다.
- 이 티켓에서는 릴리스를 내지 않고, Prepare release를 실행하지 않고, `develop`을 만들거나 저장소 설정을 바꾸지 않는다.
