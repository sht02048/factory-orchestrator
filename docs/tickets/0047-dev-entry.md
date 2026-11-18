---
status: done
blocked_by: []
---

# 개발 진입점 `pnpm dev` (가짜 어댑터, 미리 채운 모드와 온보딩 모드)

## 목표

운영자와 개발자가 명령 하나로 화면을 바로 보고 만져 본다. 실제 Linear 키·러너 ssh·GitHub 토큰 없이, 온보딩을 마친 화면과 온보딩 5단계를 모두 확인할 수 있다.

## 배경

운영자 요청(2026-11-18): 지금은 init → start → 온보딩 5단계(실제 Linear 키·러너 ssh 필요)를 거쳐야 화면을 볼 수 있어 무엇을 보기가 어렵다. 루트에는 dev 스크립트가 없고 `apps/web`의 vite dev만 있어 worker도 DB도 없다. 그래서 루트 `pnpm dev` 자체를 개발 진입점으로 한다(코디네이터 지시, 같은 날).

## 범위

- **명령.** 루트 `pnpm dev`가 web 개발 서버(핫 리로드)와 worker를 한 프로세스에서 띄운다.
  - `pnpm dev`: 미리 채운 모드. 온보딩을 마친 설치로 홈이 바로 열린다.
  - `pnpm dev --onboarding`: 온보딩 모드. 빈 DB에서 온보딩 1단계부터 시작한다.
  - `--reset`: 그 모드의 데이터를 지우고 처음 상태로 띄운다. `--static`: 가짜 에이전트가 스스로 움직이지 않는다.
  - 데이터는 저장소의 `.dev/<모드>/`(gitignore)에 둔다. `FACTORY_DEV_DIR`로 바꿀 수 있고 `~/.factory-orchestrator`는 건드리지 않는다. 바인드 주소·포트는 `WEB_HOST`·`WEB_PORT`(기본 `127.0.0.1:3000`).
- **가짜 어댑터.** core 시험용 가짜(`@factory/core/testing`)를 저장한 종류(`linear`·`orca`·`github`)로 등록해 화면이 실제 설치처럼 보인다. 등록은 개발 진입점(`demo/` 워크스페이스 패키지)에서만 한다. web은 e2e 브라우저 시험(0039)과 같은 vite 플러그인으로 `server/adapters.ts`를 바꿔 끼우고, worker는 `startWorker`에 등록표를 넘긴다. 제품의 등록표와 빌드 설정은 고치지 않는다(ADR 0008).
  - 입력값으로 확인 결과를 정한다. 키·토큰에 `invalid`가 있으면 인증 실패, ssh 대상에 `offline`·`no-orca`·`push-auth`가 있으면 Offline·Orca 상시 서비스 없음·GitHub 인증 깨짐이다.
- **미리 채운 데이터(가상 값만).** 트래커 연결 둘(Acme, Globex)과 트래커 프로젝트 셋, Workspace 둘, 러너 셋(runner-a Online, runner-b GitHub 인증 깨짐, runner-c Offline), Mapping("In Progress"·Auto-assign Label·모델), 런의 모든 상태(Queued, Running, Waiting for Input의 질문·권한 대기, Disconnected, Ended의 Merged·Human Check·Failed·Canceled), 지난 2주의 끝난 런.
- **움직임.** 가짜 러너의 에이전트가 시간에 따라 일하고, 가끔 질문하고, 답을 받으면 이어서 일한 뒤 PR을 열고 완료 보고를 보낸다. 열린 PR은 조금 뒤 병합된다. 진행 중인 런이 적으면 티켓에 Auto-assign Label을 붙여 자동 할당이 새 런을 만든다. 질문 답하기·런 취소·수동 할당은 제품 화면 그대로 한다.
- **개발 도구.** 화면 오른쪽 아래 「가짜 값 채우기」(온보딩·Settings 입력 칸을 가짜 값으로 채움)와 개발 화면 `/__dev`(라벨 붙이기, 새 티켓, 질문, runner-b 인증 고치기·깨기, 자동 진행 켜기·끄기). 제품 화면 코드와 메시지 파일은 고치지 않고, 개발 진입점의 vite 플러그인이 싣는다.
- README Commands 표와 개발 절(영어).

## 범위 밖(후속)

- 실제 어댑터로 개발하기(`.dev`의 `.env`로 진짜 Linear·러너). 지금은 `init`·`start`로 한다.
- 다시 띄우면 가짜 트래커에 붙인 라벨과 새로 만든 티켓은 사라진다. 런과 PR은 DB에서 가짜 러너·코드 호스트로 되살린다.
- 온보딩을 마치고 홈으로 갈 때 개발 서버에서 화면 스타일이 빠졌다가 새로 고치면 돌아온다. 개발 진입점이 아닌 web 개발 모드(StyleX 개발 CSS)의 동작으로 보이며 따로 확인한다.

## 완료 조건

- 시드가 런의 모든 상태와 요약 결과 넷, 지난 2주 런, 러너 셋의 상태를 만든다는 시험이 통과한다(`demo/src/seed.test.ts`).
- 시드를 쓴 DB에서 가짜 세계를 되살린 뒤 worker 한 바퀴가 진행 중인 런을 바꾸지 않는다는 시험이 통과한다.
- 제품 소스가 가짜 어댑터·개발 진입점을 import 하지 않는다는 시험(`demo/src/boundary.test.ts`)과, 서버 배포물에 가짜 어댑터·개발 전용 문자열이 없다는 배포물 정적 검사(`scripts/bundle-check.ts`, 0029의 `bundle`·`smoke:bundle`)가 통과한다.
- 실제 명령을 띄워 미리 채운 모드의 홈·Runs·Runners·Stats·Tickets가 온보딩으로 보내지 않고 200을 주고, SIGTERM에 포트를 닫는다는 시험이 통과한다(`demo/src/dev.test.ts`).
- 온보딩 모드에서 브라우저로 가짜 값을 채워 5단계를 마치면 홈이 열린다는 시험이 통과한다.
