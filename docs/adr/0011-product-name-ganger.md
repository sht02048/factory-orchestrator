# 제품 이름은 Ganger다

운영자가 2026-11-18에 제품 이름을 Factory Orchestrator에서 **Ganger**로 바꾸기로 했다(티켓 0076). 0.1.0 공개(0031) 전에 바꾼다. 공개 뒤에 바꾸면 설치 폴더·패키지·저장소 링크를 두 번 옮겨야 한다. ADR 0005가 "이름 `factory-orchestrator`는 임시다"라고 남긴 것을 이 ADR이 정한다. 이 ADR은 이름이 들어가는 자리마다 새 이름을 하나씩 정하고, 이미 설치한 곳을 옮기는 규칙을 정한다. 실제로 바꾸는 일은 0077(로고·아이콘), 0078(코드·패키지·문서), 0079(GitHub 저장소 이름)가 한다.

## 이름 표

2026-11-18 `main`(9c4e999)에서 `git grep -i factory`로 찾은 자리다(추적 파일 274개, lockfile 포함). 0078을 시작할 때 다시 센다. 표에 없는 자리가 나오면 같은 규칙(화면에 보이는 이름은 `Ganger`, 기계가 읽는 이름은 소문자 `ganger`, 환경 변수는 `GANGER_`)으로 바꾸고 이 표에 더한다.

### 화면·문서에 보이는 이름

| 자리                                                                          | 지금                                       | 새 이름                   |
| ----------------------------------------------------------------------------- | ------------------------------------------ | ------------------------- |
| 제품 이름(문서·화면에 쓰는 이름)                                              | Factory Orchestrator, factory-orchestrator | Ganger                    |
| README·GLOSSARY 제목                                                          | `# Factory Orchestrator`                   | `# Ganger`                |
| 웹 문서 제목(`apps/web/messages/ko/*.json`의 `documentTitle`)                 | `… · Factory Orchestrator`                 | `… · Ganger`              |
| 웹 레일 브랜드(`shell.json`의 `brand`)                                        | Factory Orchestrator                       | Ganger                    |
| worker 알림 제목(`apps/worker/src/messages.ts`)                               | Factory Orchestrator 런이 끝났어요.        | Ganger 런이 끝났어요.     |
| 데스크톱 창 제목, 오류 대화상자 제목, 트레이 툴팁, renderer `<title>`         | Factory Orchestrator                       | Ganger                    |
| 데스크톱 "우리 서버가 아니에요" 문구(`apps/desktop/messages/ko/screens.json`) | 그 주소는 Factory Orchestrator 서버가 …    | 그 주소는 Ganger 서버가 … |
| 메뉴 막대의 앱 이름(Electron `app.name`, `productName`에서 온다)              | Factory Orchestrator                       | Ganger                    |
| `LICENSE` 저작권 줄                                                           | Factory Orchestrator contributors          | Ganger contributors       |
| `.env` 머리 주석(`apps/cli/src/init.ts`), `.env.example`                      | factory-orchestrator                       | Ganger(명령은 `ganger`)   |
| CLI 도움말(`apps/cli/src/messages.ts`)                                        | `factory-orchestrator <command>`           | `ganger <command>`        |
| 정적 시안(`design/prototype/`)의 브랜드 글자                                  | factory-orchestrator, `F`                  | Ganger, `G`               |

### 코드·패키지·배포물 이름

| 자리                                                                                       | 지금                                                            | 새 이름                                                      |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------ |
| 루트 `package.json` `name`                                                                 | `factory-orchestrator`                                          | `ganger`                                                     |
| 워크스페이스 패키지 범위(core, db, ui, web, worker, cli, desktop, demo, e2e, 어댑터 셋)    | `@factory/*`                                                    | `@ganger/*`                                                  |
| CLI 명령(`apps/cli/package.json` `bin`)                                                    | `factory-orchestrator`                                          | `ganger`                                                     |
| 서버 배포물 폴더·tarball(`scripts/bundle.ts`)                                              | `dist/factory-orchestrator-<version>/`, `.tar.gz`               | `dist/ganger-<version>/`, `.tar.gz`                          |
| `/api/identity`의 `product` 값(web `identity.ts`, 데스크톱 `core/identity.ts`, smoke 시험) | `factory-orchestrator`                                          | `ganger`                                                     |
| 개발 진입점 전역 이름(`demo/`, `scripts/bundle-check.ts`의 표시)                           | `__factoryDev`, `__factoryDemoWorld`                            | `__gangerDev`, `__gangerDemoWorld`                           |
| 개발 Vite 플러그인·도구 id(`demo/src/plugins.ts`, `prefill.ts`, `bundle-check.ts`)         | `factory-dev-adapters`, `factory-dev-tools`, `factory-dev-page` | `ganger-dev-adapters`, `ganger-dev-tools`, `ganger-dev-page` |
| 시험의 임시 폴더 접두어(`mkdtemp`)                                                         | `factory-…`                                                     | `ganger-…`                                                   |
| 런의 결정적 워크트리 이름(`packages/db/src/runs.ts`, `demo/src/life.ts`의 해석)            | `factory-<티켓 키>-<n>`                                         | `ganger-<티켓 키>-<n>`                                       |
| 러너의 우편함 터미널 제목(`packages/runner-orca/src/orca-runner.ts`)                       | `factory-orchestrator-mailbox`                                  | `ganger-mailbox`                                             |
| 러너의 오케스트레이션 Run objective                                                        | `factory-orchestrator`                                          | `ganger`                                                     |
| push 권한 확인 ref(`git push --dry-run`)                                                   | `HEAD:refs/heads/factory-orchestrator/push-check`               | `HEAD:refs/heads/ganger/push-check`                          |
| GitHub API User-Agent(`packages/codehost-github/src/http.ts`)                              | `factory-orchestrator`                                          | `ganger`                                                     |
| DB 마이그레이션 번들 플러그인 이름(`packages/db/src/bundle-migrations.ts`)                 | `factory-bundle-migrations`                                     | `ganger-bundle-migrations`                                   |
| 개발 DB 파일(`demo/src/main.ts`)                                                           | `.dev/<mode>/data/factory-orchestrator.db`                      | `.dev/<mode>/data/ganger.db`                                 |
| 제품 이름이 든 코드 식별자(`apps/cli`의 `factoryHome` 등)                                  | `factoryHome`                                                   | `gangerHome`                                                 |
| 데스크톱 `package.json` `description`                                                      | `… for factory-orchestrator`                                    | `… for Ganger`                                               |

러너 쪽 이름은 원격(러너의 Orca, 사용자 저장소)에 남지만, 바꿔도 이미 돌고 있는 런은 깨지지 않는다. 워크트리 이름은 할당할 때 DB에 저장하고 worker는 저장한 값을 다시 읽으므로(`apps/worker/src/worker.ts`의 `run.worktreeName`), 이미 할당한 런은 옛 접두어로 끝까지 가고 새로 할당한 런부터 `ganger-`를 쓴다. 우편함 터미널 제목과 Run objective는 만들 때만 쓰고 그 뒤에는 저장한 핸들과 Run id로 다시 쓰므로, 이미 만든 우편함은 옛 제목으로 남고 새로 만들 때부터 새 이름을 쓴다. push 확인 ref는 `--dry-run`이라 원격에 만들어지지 않는다. 개발 DB(`pnpm dev`)는 옮기지 않는다. 옛 파일은 남고 무시되며, 개발 데이터는 시드로 다시 만든다. 개발 모드 Electron userData도 패키지 이름(`@ganger/desktop`)을 따라 바뀌고 옮기지 않는다.

`@ganger/*`는 pnpm 워크스페이스 안에서만 쓰는 이름이다. 모든 `package.json`이 `"private": true`이고 npm으로 내지 않는다(0031 배포 경로 결정). 그래서 npm 레지스트리의 `@ganger` 범위나 `ganger` 패키지를 다른 사람이 갖고 있어도 설치·빌드에 영향이 없고, 그 이름을 확보할 필요도 없다. 나중에 npm으로 내기로 하면 그때 이름을 다시 정한다.

시험 데이터에 쓰는 낱말 `factory`(라벨 이름 `factory`, ssh 대상 `factory@runner-a.example.com`, 코드 호스트 fixture의 브랜치 `factory/ENG-130-1`, `linearTrackerFactory` 같은 팩토리 함수 이름)는 제품 이름이 아니라 가상 값과 일반 낱말이라 바꾸지 않는다.

### 설치·데이터 폴더와 환경 변수

| 자리                                            | 지금                                   | 새 이름                    |
| ----------------------------------------------- | -------------------------------------- | -------------------------- |
| 기본 설치 폴더(`apps/cli/src/home.ts`)          | `~/.factory-orchestrator`              | `~/.ganger`                |
| 기본 DB 파일                                    | `<home>/data/factory-orchestrator.db`  | `<home>/data/ganger.db`    |
| CLI 서비스 로그(macOS)                          | `<home>/logs/factory-orchestrator.log` | `<home>/logs/ganger.log`   |
| 데스크톱 서버 로그                              | `<home>/logs/desktop-server.log`       | 그대로                     |
| 설치 폴더 환경 변수                             | `FACTORY_HOME`                         | `GANGER_HOME`              |
| Tailscale CLI 경로                              | `FACTORY_TAILSCALE_CLI`                | `GANGER_TAILSCALE_CLI`     |
| 데스크톱 userData 경로                          | `FACTORY_DESKTOP_USER_DATA`            | `GANGER_DESKTOP_USER_DATA` |
| 데스크톱이 쓸 서버 배포물                       | `FACTORY_SERVER_BUNDLE`                | `GANGER_SERVER_BUNDLE`     |
| 개발 데이터 폴더(`pnpm dev`)                    | `FACTORY_DEV_DIR`                      | `GANGER_DEV_DIR`           |
| worker 깨우기 신호(티켓 0058, 아직 코드에 없음) | `FACTORY_WORKER_WAKE`                  | `GANGER_WORKER_WAKE`       |

부팅 설정 이름(`DATABASE_PATH`, `ENCRYPTION_KEY`, `WEB_HOST`, `WEB_PORT`)은 제품 이름이 없어 그대로 둔다.

### 서비스·데스크톱 앱

| 자리                                                       | 지금                                                                        | 새 이름                                         |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------- |
| launchd 라벨과 파일                                        | `factory-orchestrator`, `~/Library/LaunchAgents/factory-orchestrator.plist` | `ganger`, `~/Library/LaunchAgents/ganger.plist` |
| systemd 사용자 서비스                                      | `factory-orchestrator.service`                                              | `ganger.service`                                |
| systemd `Description`                                      | `factory-orchestrator (web and worker)`                                     | `Ganger (web and worker)`                       |
| 데스크톱 `productName`·packager `name`·실행 파일 이름      | `Factory Orchestrator`                                                      | `Ganger`                                        |
| 데스크톱 앱 묶음                                           | `Factory Orchestrator.app`                                                  | `Ganger.app`                                    |
| 데스크톱 스테이지 `package.json` `name`                    | `factory-orchestrator-desktop`                                              | `ganger-desktop`                                |
| 번들 ID(`appBundleId`)                                     | `dev.factory-orchestrator.desktop`                                          | `dev.ganger.desktop`                            |
| 데스크톱 zip                                               | `Factory Orchestrator-<version>-darwin-<arch>.zip`                          | `Ganger-<version>-darwin-<arch>.zip`            |
| dmg(0031)                                                  | 아직 없음                                                                   | `Ganger-<version>.dmg`, 볼륨 이름 `Ganger`      |
| 데스크톱 userData(Electron 기본값, `productName`에서 온다) | `~/Library/Application Support/Factory Orchestrator`                        | `~/Library/Application Support/Ganger`          |
| 로그인 항목                                                | 앱 묶음 `Factory Orchestrator.app`(`setLoginItemSettings`)                  | `Ganger.app`                                    |

### 저장소

| 자리                    | 지금                   | 새 이름                                                                              |
| ----------------------- | ---------------------- | ------------------------------------------------------------------------------------ |
| GitHub 저장소 이름      | `factory-orchestrator` | `ganger`(소유 계정은 그대로)                                                         |
| 저장소 주소를 적는 자리 | 아직 없음              | `https://github.com/<owner>/ganger` 꼴. 저장소 문서에는 소유 계정 이름을 쓰지 않는다 |

## 번들 ID와 도메인

번들 ID는 지금처럼 계정과 무관한 `dev.<제품>.desktop` 꼴로 `dev.ganger.desktop`을 쓴다. 운영자 계정 이름, 실명, 회사 도메인을 넣지 않는다(ADR 0005, AGENTS.md 공개 저장소).

`ganger.dev` 도메인은 갖고 있지 않고, 갖지 않아도 된다. 근거는 일반 지식 수준이다. 번들 ID(`CFBundleIdentifier`)의 역도메인 꼴은 이름이 겹치지 않게 하려는 관례이고, macOS·Developer ID 서명·공증은 그 도메인을 누가 가졌는지 확인하지 않는다. Apple Developer 계정에서 App ID를 등록할 때(특별한 권한이 필요한 앱이나 Mac App Store)는 같은 계정 체계 안에서 먼저 등록한 쪽이 갖는데, 0.1.0은 Developer ID로 서명한 dmg만 내므로(0031) 이 등록이 필요하지 않을 것으로 본다. 이 판단은 0031에서 서명·공증을 처음 돌릴 때 확인한다.

같은 번들 ID를 다른 앱이 쓰면 한 맥 안에서 환경설정 영역(`~/Library/Preferences/dev.ganger.desktop.plist`)과 개인정보 보호 권한 기록을 함께 쓰게 된다. 이 위험은 이름이 흔치 않아 작다고 보지만 확인하지는 못했다.

## 이미 설치한 곳 옮기기

공개 릴리스가 없어 옛 이름으로 설치한 곳은 저장소에서 만든 서버 배포물·데스크톱 앱뿐이다. 그래도 저장 경로를 바꾸는 one-way 결정이라 아래 규칙대로 자동으로 옮긴다(운영자 결정 2026-11-18). 옛 이름을 받는 기간은 0.1.x 동안이고, 0.2.0에서 옛 이름을 받는 코드와 아래 심볼릭 링크를 지운다.

### 설치 폴더

새 CLI(`ganger`)와 새 데스크톱 앱이 설치 폴더를 고를 때 아래 규칙을 따른다. 데스크톱 앱도 CLI와 같은 `resolveHome`을 쓴다.

- 설치 폴더를 `--home`, `GANGER_HOME`, `FACTORY_HOME`으로 따로 골랐으면 옮기지 않고 그 자리를 그대로 쓴다. 운영자가 정한 이름이다.
- `~/.factory-orchestrator`가 `~/.ganger`가 아닌 곳을 가리키는 심볼릭 링크면(데이터를 다른 디스크로 옮겨 둔 경우), 옮기지 않고 옛 경로를 설치 폴더로 쓰며 경고한다. `~/.ganger`를 새로 만들지 않는다. 새로 만들면 `init`이 새 암호화 키와 빈 DB를 만들어 데이터가 둘로 갈라진다.
- `~/.ganger`가 있는데 `~/.factory-orchestrator`도 실제 폴더로 있으면, 아무것도 옮기지 않고 `~/.ganger`를 쓰며 두 폴더가 다 있다고 경고한다.
- `~/.ganger`가 없고 `~/.factory-orchestrator`가 실제 폴더로 있으면 아래 순서로 한 번 옮긴다.

옮기는 쪽은 처음부터 끝까지 옛 폴더의 `server.lock`을 직접 잡는다. 살아 있는 서버가 lock을 잡고 있으면 아무것도 하지 않고 옛 폴더를 그대로 쓰며, 서버를 멈추거나 `ganger service install`을 돌리라고 알린다(아래 서비스). lock을 잡은 동안에는 다른 `start`가 뜨지 못하므로, 확인과 이름 바꾸기 사이에 launchd가 옛 서비스를 다시 띄워도 그 서버는 lock에서 멈춘다.

1. DB를 열어 WAL을 본 파일에 모두 옮기고(`PRAGMA wal_checkpoint(TRUNCATE)`) 닫는다. 그 뒤 DB는 본 파일 하나라, 이름을 바꿀 때 `-wal`·`-shm`을 따로 옮기지 않는다(남은 `-shm`은 지운다).
2. `~/.factory-orchestrator`를 `~/.ganger`로 이름을 바꾼다(`rename` 한 번). `rename`이 실패하면(`EXDEV`, `EBUSY` 등, 옛 폴더가 마운트 지점인 경우) 옮기지 않고 옛 폴더를 그대로 쓰며 경고한다.
3. `~/.factory-orchestrator`에 `~/.ganger`를 가리키는 심볼릭 링크를 만든다. 옛 서비스·옛 앱·옛 CLI가 옛 경로로 같은 데이터를 계속 본다. 동시에 두 서버가 뜨는 것은 지금처럼 `server.lock`이 막는다. 되돌려 옛 버전을 돌려도 데이터가 둘로 갈라지지 않는다.
4. 마무리(아래)를 한다.
5. 무엇을 옮겼는지 한 줄로 알린다(CLI는 stderr, 데스크톱은 `desktop-server.log`).

**마무리.** `.env`의 `DATABASE_PATH`가 옛 폴더 아래(`~/.factory-orchestrator/…`)를 가리키면 새 경로를 정한다. 접두어를 `~/.ganger/`로 바꾸고, 파일 이름이 옛 기본값 `factory-orchestrator.db`면 `ganger.db`로 바꾼다. 다른 이름(예: `data/custom.db`)은 접두어만 바꾼다. 옛 폴더 밖을 가리키면 손대지 않는다. 그다음 두 파일의 상태로 이어서 할 일을 고른다.

| 옛 경로의 DB | 새 경로의 DB | 할 일                                                                               |
| ------------ | ------------ | ----------------------------------------------------------------------------------- |
| 있음         | 없음         | 위 1처럼 WAL을 옮긴 뒤 DB 파일 이름을 바꾸고 `.env`를 고친다                        |
| 없음         | 있음         | 이름은 이미 바꿨다. `.env`만 고친다                                                 |
| 있음         | 있음         | 아무것도 바꾸지 않고 서버를 띄우지 않는다. 두 DB가 다 있다고 알리고 운영자가 고른다 |
| 없음         | 없음         | 아무것도 바꾸지 않는다. 지금처럼 `start`가 빈 DB를 만든다                           |

`.env`는 `DATABASE_PATH` 줄의 값만 바꾸고 다른 줄·주석·암호화 키는 그대로 둔다. 값은 `renderEnvFile`과 같은 꼴(`JSON.stringify` 따옴표)로 쓴다. 같은 폴더의 임시 파일을 `0600`으로 만들어 쓰고 `rename`으로 바꾼다. `.env`에는 암호화 키가 있어 `init`도 `0600`으로 쓴다.

마무리는 옮긴 때만이 아니라, 설치 폴더가 `~/.ganger`이고 `.env`가 옛 폴더 아래를 가리킬 때마다 `server.lock`을 잡고 `start`가 서버를 띄우기 전에 한다. 그래서 2와 3 사이나 마무리 도중에 멈춰도 다음 실행이 이어서 하고, `.env`가 없는 DB를 가리킨 채 서버가 떠 빈 DB를 만드는 일이 없다. 3 전에 멈춰 링크가 없으면 다음 실행이 링크를 만든다.

### 환경 변수

0.1.x 동안 새 이름이 없으면 옛 이름(`FACTORY_*`)을 읽고, 옛 이름을 읽을 때마다 새 이름을 쓰라고 경고한다. 둘 다 있으면 새 이름을 쓰고 옛 이름은 무시한다고 경고한다. 이 규칙은 위 표의 다섯 변수(`FACTORY_HOME`, `FACTORY_TAILSCALE_CLI`, `FACTORY_DESKTOP_USER_DATA`, `FACTORY_SERVER_BUNDLE`, `FACTORY_DEV_DIR`)에 같이 적용하고, 한 함수가 맡는다. 두 이름을 받는 동안 시험이 환경 변수를 비울 때(`apps/desktop/smoke/helpers.ts`, `scripts/smoke-cli.ts`)는 옛 이름과 새 이름을 함께 비운다. 개발자 셸의 값이 시험에 새어 들지 않게 하려는 것이다. `GANGER_WORKER_WAKE`는 `start`가 자식에게 넣는 내부 값이라 옛 이름을 받지 않는다.

### `/api/identity`의 product 값

새 서버는 `product: "ganger"`를 돌려준다. 새 데스크톱 앱은 0.1.x 동안 `"factory-orchestrator"`도 우리 서버로 받는다. 원격 서버만이 아니라 로컬 서버를 확인할 때도 같다. 데스크톱은 로컬 서버도 같은 `probeIdentity`로 확인하는데(`apps/desktop/src/core/local-server.ts`), 위 규칙대로 옛 서비스나 옛 앱이 띄운 옛 서버가 로컬에서 돌 수 있기 때문이다. 옛 데스크톱 앱은 새 서버를 "우리 서버가 아니에요"로 본다. 옛 앱은 공개하지 않았으므로 새 앱으로 바꾸면 된다.

### 서비스(launchd·systemd)

옛 서비스 파일(`factory-orchestrator.plist`, `factory-orchestrator.service`)에는 옛 배포물의 CLI 경로와 `--home ~/.factory-orchestrator`, 옛 로그 경로가 들어 있다. 이 파일을 자동으로 고쳐 쓰지 않는다.

- 옛 서비스가 돌고 있으면 `server.lock`을 잡고 있어 설치 폴더를 옮기지 않는다. 옛 서비스는 옛 폴더에서 그대로 돈다.
- `ganger service install`은 이 순서로 한다. 옛 서비스를 멈춘다(`launchctl bootout gui/<uid>/factory-orchestrator`, `systemctl --user disable --now factory-orchestrator.service`). 설치 폴더를 옮긴다. 새 서비스(`ganger`, `--home ~/.ganger`, `<home>/logs/ganger.log`)를 쓰고 켠다. 새 서비스가 켜진 뒤에만 옛 파일을 지우고, systemd면 `systemctl --user daemon-reload`를 한다. 중간에 실패하면 옛 파일이 남아 있으므로 무엇이 실패했는지 알리고, 다시 `ganger service install`을 돌리면 이어서 한다. 옛 서비스는 멈춘 채로 둔다. `ganger service uninstall`도 옛 서비스가 있으면 함께 지운다.
- 이미 옮긴 뒤(심볼릭 링크가 있는 뒤)에 옛 서비스가 다시 돌아도 옛 경로가 링크라 같은 데이터를 쓴다. 다음 `ganger service install`에서 새 경로로 바뀐다.
- 0.1.x 동안 데스크톱 앱이 서비스가 설치됐는지 볼 때(`serviceInstalledFor`) 옛 plist도 본다. 그 안의 `--home`이 옛 경로든 새 경로든 같은 설치로 본다.

### 데스크톱 앱

- **userData.** 새 앱의 userData(`~/Library/Application Support/Ganger`)에 `settings.json`이 없고 옛 userData(`~/Library/Application Support/Factory Orchestrator`)에 있으면, 첫 실행에서 `settings.json`만 복사한다. `server-process.json`은 옛 앱이 띄운 프로세스 기록이라 복사하지 않는다. 옛 폴더는 남긴다. 크기가 작고, 옛 앱으로 되돌릴 때 필요하다. 0.2.0에서는 복사하지 않는다.
- **로그인 항목.** 로그인 항목은 앱 묶음에 붙는다. 복사한 설정에 "로그인할 때 열기"가 켜져 있으면 새 앱이 첫 실행에서 자기를 로그인 항목으로 등록한다. 지금은 로컬 서버를 고를 때만 `setLoginItemSettings`를 부르므로(`controller.ts`), 0078에서 첫 실행 때 부르는 코드를 더한다. 옛 앱의 로그인 항목은 새 앱이 지울 수 없다(다른 번들이다). 옛 앱을 지우라고 안내한다.

## 저장소 이름과 옛 주소

운영자가 GitHub 설정에서 저장소 이름을 `ganger`로 바꾼다(0079). GitHub은 이름을 바꾼 저장소의 옛 주소에서 웹 링크와 git clone·fetch·push를 새 주소로 넘겨준다. 같은 계정에 옛 이름으로 새 저장소를 만들면 이 전달이 끊긴다(GitHub 문서 기준의 일반 지식, 이 티켓에서 다시 확인하지 않았다).

이 전달에는 저장소 밖에 남은 옛 링크(지난 PR·이슈의 링크, 다른 사람의 clone)가 깨지지 않게 하는 안전망으로만 기댄다. 저장소 안의 주소, 작업 환경의 git remote, 데스크톱 앱의 업데이트·릴리스 주소는 0079에서 새 주소로 고치고 전달에 기대지 않는다. 옛 이름 `factory-orchestrator`로 새 저장소를 만들지 않는다.

## 다른 이름과 겹치는지

- 확인한 것: 저장소 안에는 Ganger라는 다른 뜻의 낱말이 없다(2026-11-18 `main`(9c4e999)에서 `git grep -i ganger`는 티켓 0031·0076·0077·0078과 `docs/tickets/README.md`에만 나온다).
- 일반 지식: `ganger`는 영어의 일반 명사(작업반을 이끄는 반장)이고, 성으로도 쓰인다. 소프트웨어 공장의 관제탑이라는 뜻과 어울린다. `doppelganger`의 뒷부분으로 읽힐 수 있다.
- 확인하지 못한 것: 같은 이름의 소프트웨어 제품·회사, 상표 등록, npm의 `ganger` 패키지와 `@ganger` 범위, GitHub의 `ganger` 계정·조직, Homebrew formula, 같은 이름이나 같은 번들 ID의 macOS 앱, `ganger.dev`·`ganger.com` 도메인의 소유자. 웹 검색은 하지 않았고 결과를 단정하지 않는다. 0.1.0 공개(0031) 전에 운영자가 상표와 같은 이름의 개발 도구를 확인한다.

## Consequences

- **설치 폴더를 옮기는 일은 되돌리기 어렵다.** 옮긴 뒤 옛 버전으로 돌아가도 심볼릭 링크로 같은 데이터를 보지만, DB 파일 이름과 `.env`의 `DATABASE_PATH`는 이미 새 이름이다. 옛 버전은 `.env`의 절대 경로를 읽으므로 그대로 돈다. 0.2.0에서 링크를 지운 뒤에는 옛 버전이 옛 경로에서 빈 폴더를 보고 `init`이 새 암호화 키를 만들 수 있다. 0.2.0 릴리스 노트에 적는다.
- **옮기는 도중 멈추면** 폴더 이름만 바뀌고 링크나 `.env`가 옛 상태일 수 있다. 서버를 띄우기 전에 lock을 잡고 마무리를 매번 확인해 이어서 하는 규칙으로 막고, 0078에서 단계마다 멈춘 경우와 마무리 표의 네 상태를 시험한다.
- **옛 코드가 새 DB에서 돌 수 있다.** 새 앱이 지울 수 없는 옛 로그인 항목이나 다시 등록하지 않은 옛 서비스가 옛 서버를 띄우면, 링크를 거쳐 새 버전이 마이그레이션한 DB에서 옛 코드가 돈다. 마이그레이션은 앞으로만 가므로 옛 코드가 새 스키마에서 실패할 수 있다. 옛 앱을 지우고 `ganger service install`을 돌리라고 옮길 때 알리는 것으로 줄인다.
- **0.2.0에서 링크를 지우면** 다시 등록하지 않은 옛 서비스(plist·unit에 `--home ~/.factory-orchestrator`가 적혀 있다)는 `.env`를 찾지 못해(`MissingEnvFileError`) 뜨지 못한다. 0.2.0 릴리스 노트에 "서비스를 다시 등록해야 한다"를 적는다.
- **lock을 잡은 채 옮기므로** 옮기는 동안 서버를 띄울 수 없다. 큰 DB면 WAL을 옮기는 데 시간이 걸릴 수 있다.
- **사용자가 직접 만든 `~/.ganger`가 있으면** 옮기지 않는다. 두 폴더가 다 있다는 경고만 남아, 사용자가 손으로 고른다.
- **옛 서비스가 돌고 있으면** 설치 폴더를 옮기지 않으므로, `ganger service install`을 돌릴 때까지 옛 이름이 남는다.
- **옛 이름을 받는 코드가 0.1.x 동안 남는다.** 0.2.0에서 지울 일을 0078의 PR 본문과 릴리스 티켓에 적는다. 0078의 `git grep` 완료 조건은 이 코드와 시험, 지난 기록(`docs/tickets`, `docs/research`), ADR을 남아도 되는 곳으로 둔다.
- 0078은 거의 모든 파일을 고친다. 다른 화면 작업과 겹치지 않게 진행 중인 화면 개편과 0074가 끝난 뒤 한 번에 한다(0078 배경).

## Considered Options

- **옛 폴더를 복사하고 그대로 두기**: 되돌리기 쉽지만, 옛 서비스가 옛 폴더를 계속 쓰면 데이터가 둘로 갈라진다. 기각했다.
- **옮기지 않고 옛 폴더가 있으면 그 자리를 쓰며 경고만 하기**: 데이터를 건드리지 않지만 옛 이름이 설치마다 계속 남는다. 기각했다.
- **옛 환경 변수를 1.0 전까지 받기**: 공개 전 설치뿐인데 옛 이름 코드를 오래 남긴다. 기각했다.
- **옛 환경 변수를 받지 않기**: 코드는 단순하지만 운영자 설치를 손으로 옮겨야 하고, 경고 없이 설치 폴더가 바뀐다. 기각했다.
- **번들 ID에 운영자 계정이나 소유한 도메인 넣기**: 공개 저장소에 개인 값이 들어간다(ADR 0005). 기각했다.
