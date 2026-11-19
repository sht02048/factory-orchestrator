---
status: done
blocked_by: []
---

# 0087 버전이 바뀐 PR이 머지되면 자동으로 릴리스

## 목표

버전을 올린 PR이 `main`에 머지되면 사람이 태그를 push하지 않아도 그 버전의 Release가 나온다.

## 배경

0031의 릴리스는 관리자가 `v*` 태그를 손으로 push해야 시작한다. 운영자와 정했다(2026-11-19).

- release-please는 쓰지 않는다. gitmoji 커밋, `CHANGELOG.md`를 두지 않는 결정(0031), 검사가 끝난 뒤 Release를 만드는 순서와 맞지 않는다.
- 버전 올리기는 Actions 탭의 "Prepare release"(workflow_dispatch, 입력 `version`)가 루트와 `apps/desktop`의 `package.json` 버전을 바꾼 PR을 연다.
- 그 PR이 머지되면 `main` push 워크플로가 버전이 바뀐 것을 보고 `v<version>` 태그를 만들고, 그 태그 push가 지금의 `release.yml`(plan → CI → macOS 서명·공증·검사 → publish)을 시작한다.

## 설계 결정

- **GitHub App 토큰을 쓴다(운영자 결정 2026-11-19, B안).** 기본 `GITHUB_TOKEN`으로 만든 PR·태그는 다른 워크플로를 시작하지 않는다. 그 PR에서는 필수 검사 `check`가 돌지 않아 머지할 수 없고, 그 태그는 `release.yml`을 시작하지 않는다. 앱 토큰으로 만든 PR과 태그는 보통 사람이 만든 것처럼 CI와 tag push 워크플로를 시작한다.
- **`release` environment는 `v*` 태그만 그대로 둔다.** 처음 결정은 태그를 만든 실행에서 `release.yml`을 workflow_call로 부르는 것이었다. 그러나 workflow_call로 부른 워크플로는 부른 쪽 ref(`refs/heads/main`)로 돌아, `v*` 태그만 받는 `release` environment에 들어가지 못한다. environment에 `main`을 더하면 `main`의 아무 잡이나 `environment: release`만 적어 서명 secret을 바로 읽게 된다. 그래서 자동 경로는 앱이 만든 태그의 tag push로 하고, `release.yml`은 workflow_call(입력 `tag`)도 받게만 둔다. workflow_call로 부를 때도 부른 쪽이 `v*` 태그에서 돌아야 서명 단계가 environment에 들어간다.
- **앱 secret은 새 environment `release-bot`에 둔다.** 배포 규칙을 `main` 브랜치로 묶는다. 서명 secret 다섯 개는 `release` environment 밖으로 나가지 않는다.
- **신뢰 경계: `main`에 머지할 수 있으면 서명할 수 있다.** `release-bot`은 `main`의 아무 잡이나 쓸 수 있고, 앱은 `v*` 태그를 만들 수 있으며, 그 tag push는 태그 커밋의 `release.yml`을 `release` environment에서 돌린다. 그래서 자동 병합된 PR 하나(버전 올림과 함께 워크플로를 바꾼 것)로도 사람 손 없이 서명 secret에 닿을 수 있다. 전에는 관리자가 태그를 만드는 것이 사람 확인 지점이었다. 이 PR은 그 확인 지점을 없앤다. 막으려면 운영자가 `release` environment에 required reviewers를 걸어 서명 잡 앞에서 한 번 승인하게 한다(README 7단계, 선택). 걸지 않으면 이 위험을 받아들이는 것이다. 어느 쪽인지는 운영자가 정한다.
- **앱 권한은 최소로.** Repository permissions: Contents read and write, Pull requests read and write(Metadata read는 자동). 워크플로에서 토큰을 만들 때도 그 둘만 달라고 한다. Webhook은 끈다.
- **`v*` 태그 ruleset("Release tags")의 bypass에 앱을 더한다.** 관리자만 우회하던 것에 이 앱 하나만 더한다. GitHub Actions 앱(`GITHUB_TOKEN`)은 더하지 않는다.

## 범위

- `scripts/release-version.ts`: 버전 형식 검사, 버전 비교(semver 우선순위, prerelease 포함), 두 `package.json`의 버전 바꾸기. CLI `bump <version>`은 새 버전이 지금보다 높지 않으면 멈춘다.
- `scripts/release-tag.ts`: 앞 커밋과 지금 커밋의 루트·`apps/desktop` 버전을 보고 태그를 만들지 정한다. 둘 다 그대로면 만들지 않는다. 바뀌었으면 둘이 같고 형식이 맞고 앞 버전보다 높아야 하며, 아니면 실패한다. 같은 태그가 이미 이 커밋에 있으면 건너뛰고, 다른 커밋에 있으면 실패한다.
- `.github/workflows/prepare-release.yml`("Prepare release"): workflow_dispatch(입력 `version`). `release-bot` environment에서 앱 토큰을 만들어 `release/v<version>` 브랜치에 버전 커밋을 push하고 PR을 연다. 브랜치가 이미 있으면 멈춘다.
- `.github/workflows/tag-release.yml`("Tag release"): `main` push. secret 없는 잡이 태그를 정하고, 태그가 필요할 때만 `release-bot` environment 잡이 앱 토큰으로 태그 ref를 만든다. 동시 실행 그룹은 커밋마다 따로 둔다. 그룹 하나로 묶으면 대기 중인 앞 실행이 뒤 실행에 밀려 취소돼 버전 머지를 놓친다. 태그 만들기는 이미 있는 태그를 보고 건너뛰거나 실패해 몇 번 돌아도 안전하다.
- `release.yml`: tag push와 workflow_call(입력 `tag`) 둘 다로 돈다. 태그를 명시해 체크아웃하고, plan에서 이미 같은 Release가 있으면 macOS 단계 전에 멈춘다. 태그=버전, 태그 커밋이 `origin/main`에 있는지 보는 검사는 그대로다.
- 앱이나 secret이 아직 없으면 두 워크플로는 무엇을 설정할지 알려 주는 오류로 멈춘다.
- README 릴리스 절에 새 흐름과 운영자 설정 단계를 영어로 적는다. 0031의 "버전과 변경 기록" 줄을 새 흐름으로 고친다.
- 저장소 설정(앱, environment, secret, ruleset)은 이 티켓에서 바꾸지 않는다. 바꿀 명령은 README와 PR 본문에 적고, 운영자가 확인한 뒤 적용한다.

## 운영자 설정(이 PR 머지 전후, 첫 자동 릴리스 전)

README "Automatic releases" 절의 단계를 따른다. 요약:

1. GitHub App을 만든다(Webhook 끔, Contents·Pull requests read and write, 이 계정에만 설치). 개인 키를 만든다.
2. 앱을 이 저장소에만 설치한다.
3. environment `release-bot`을 만들고 배포 규칙을 `main` 브랜치로 묶는다.
4. 그 environment에 secret `RELEASE_APP_ID`(앱 ID), `RELEASE_APP_PRIVATE_KEY`(개인 키 PEM)를 넣는다.
5. ruleset "Release tags"의 bypass에 앱을 더한다(`actor_type: Integration`, `actor_id`: 앱 ID).
6. (선택) `release` environment에 required reviewers를 걸어 서명 잡 앞에서 사람이 한 번 승인하게 한다. 걸지 않으면 「신뢰 경계」의 위험을 받아들이는 것이다.

`release-bot` environment가 없을 때 그 잡이 돌면 GitHub이 배포 규칙 없는 environment를 저절로 만든다. 버전 PR을 머지하기 전에 3번을 먼저 한다.

## 완료 조건

- `scripts/release-version.test.ts`, `scripts/release-tag.test.ts`가 버전 비교, 버전 바꾸기, 태그 결정(그대로·올림·낮춤·형식 오류·두 버전 불일치·이미 있는 태그)을 시험한다.
- `actionlint`가 `.github/workflows/*.yml`에서 아무것도 찾지 않는다.
- 이 티켓에서는 태그를 만들거나 push하지 않고 실제 릴리스를 시작하지 않는다. 첫 자동 릴리스는 운영자 설정 뒤 "Prepare release"로 다음 rc 버전을 올려 시험한다.
