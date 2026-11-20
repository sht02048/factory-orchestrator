---
status: done
blocked_by: []
---

# 0140 `pnpm dev` 는 데스크톱 앱, `pnpm dev:web` 은 웹

## 목표

운영자 요청(2026-11-20): "pnpm dev 했을 때 일렉트론 앱이 뜨게 해 줘. pnpm dev:web 하면 웹을 뜨게 해 주고."

- `pnpm dev:web` 은 지금까지의 `pnpm dev`(티켓 0047, 가짜 어댑터·시드로 web+worker 개발 서버, 브라우저로 연다)와 같다. `--onboarding`·`--reset`·`--static`, `GANGER_DEV_DIR`·`WEB_HOST`·`WEB_PORT`를 그대로 받는다.
- `pnpm dev` 는 같은 개발 서버를 띄우고, 데스크톱 앱(Electron)을 개발 모드로 띄워 그 서버에 붙인다. 웹 화면의 핫 리로드가 앱 안에서도 먹는다.

## 정한 것

- 데스크톱 앱은 개발 서버 주소를 환경 변수 `GANGER_DESKTOP_DEV_SERVER`로만 받는다. 이 값이 있으면 저장한 모드(이 Mac·다른 서버)를 읽지 않고 그 주소에 원격 서버처럼 붙고, 자기 서버 묶음을 띄우지 않는다. 데스크톱 코드는 `demo/`를 import 하지 않는다(0047).
- 앱 데이터는 `<GANGER_DEV_DIR 또는 .dev>/desktop/user-data`(`GANGER_DESKTOP_USER_DATA`), 앱이 쓰는 Ganger 홈은 `<…>/desktop/home`(`GANGER_HOME`)으로 나눈다. 설치한 Ganger 앱의 설정·서버 목록·`~/.ganger`를 건드리지 않는다. userData 가 달라 설치한 앱과 같이 띄워도 단일 인스턴스 잠금에 걸리지 않는다.
- 데스크톱 main·preload·renderer 는 `pnpm dev` 를 시작할 때 Vite 로 한 번 빌드한다(2초 안팎). watch 는 두지 않는다: 핫 리로드가 필요한 것은 웹 화면이고, 앱 화면은 개발 모드에서 서버 화면만 연다. main 을 고치면 `pnpm dev` 를 다시 띄운다.
- Electron 바이너리가 없으면 설치 명령을 알려 주고 개발 서버를 띄우기 전에 끝낸다. `electron` 45 패키지는 처음 불릴 때 바이너리를 스스로 내려받으므로, 이 안내는 내려받기도 실패한 경우(오프라인 등)에 나온다.
- 개발 서버 모드의 앱은 서버 묶음이 없다(`bundlelessServer`). 개발 중 앱 메뉴로 '이 Mac' 모드를 고르면 서버를 띄우지 못하고 실패 화면이 나온다. 개발 서버로 돌아가려면 `pnpm dev` 를 다시 띄운다.
- 앱을 끝내면(⌘Q·트레이의 끝내기) 개발 서버도 멈추고, Ctrl+C·SIGTERM 이면 앱을 끝낸 뒤 개발 서버를 멈춘다. 창 닫기는 제품과 같이 창만 숨긴다.

## 고칠 파일

- `package.json`(`dev`, `dev:web`)
- `demo/src/main.ts`, `demo/src/server.ts`(개발 서버 시작을 함수로 뺌), `demo/src/desktop.ts`(새 진입점), 시험
- `apps/desktop/src/main/main.ts`, `apps/desktop/src/main/controller.ts`, `apps/desktop/src/core/dev-server.ts`, 시험
- README 개발 절과 데스크톱 절, AGENTS.md 의 `pnpm dev` 설명

## 완료 조건

- [x] `pnpm dev:web` 이 지금의 `pnpm dev` 와 같다(`demo/src/dev.test.ts`가 `dev:web` 진입점을 띄운다).
- [x] `pnpm dev` 가 데스크톱에 개발 서버 주소·개발 전용 userData·홈을 넘긴다(단위 시험).
- [x] 데스크톱 앱이 `GANGER_DESKTOP_DEV_SERVER`를 경계에서 파싱한다(단위 시험).
- [x] 앱이 끝나거나 신호를 받으면 앱과 개발 서버를 모두 정리한다(단위 시험).
- [x] Electron 바이너리가 없으면 설치 명령을 알린다(단위 시험).
- [x] 실제로 `pnpm dev` 를 띄워 앱이 개발 서버 화면을 열고, 웹 파일을 고치면 앱 화면이 바뀌고, ⌘Q 와 Ctrl+C 에 둘 다 끝나는 것을 확인해 PR 본문에 적는다.
