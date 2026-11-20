---
status: done
blocked_by: [0132, 0128]
---

# 0134 Settings의 서버 로그와 진단 묶음

## 목표

운영자가 Settings에서 서버 로그 크기를 보고, 로그 폴더를 열고, 재시작 없이 debug를 켜고, 이슈에 붙일 진단 묶음을 만든다. 브라우저 오류도 web 로그에 남는다. 스펙 [0004](../spec/0004-server-logs.md), 운영자 결정 L3·L6·L7·L10.

## 할 일

1. Settings(0128 Query Settings 뒤): 로그 크기 표시, 로그 폴더 열기(데스크톱 앱), debug 스위치(설치 설정에 저장, 세 프로세스가 줄마다 읽는 수준에 반영), 진단 묶음 만들기. 로그 지우기 버튼은 두지 않는다.
2. 진단 묶음 zip: 버전·Node·OS·실행 방식·프로세스 생존·DB·WAL 크기·마이그레이션, 비밀과 주소를 뺀 설정 요약, 러너(별칭), 최근 런, webhook 수신 기록, 고른 런의 런 타임라인, 최근 서버 로그(warn 이상 7일 + info 최근 줄), `process.report` 요약(환경 변수 제외). 이름에 짧은 식별자.
3. 익명화(기본 켬, 끌 수 있음): ssh 대상, 호스트·tailnet 주소, 홈 경로, 티켓 키 접두어(묶음 안에서 일관된 별칭). 화면에 "공개 전에 직접 확인하세요".
4. 브라우저 오류(error만)를 서버 함수 하나로 받아 web 로그에 error 줄(`event: browser.error`)로 남긴다(L7). 메시지·스택은 가리기를 거친다.
5. 데스크톱 메뉴에도 진단 묶음 만들기.

## 완료 조건

- [x] 시험: 알려진 비밀 모양을 넣은 로그·설정으로 묶음을 만들어도 원문이 없다(`packages/app/src/diagnostics/bundle.test.ts`).
- [x] 시험: 익명화를 켜고 끄면 ssh 대상·호스트·홈 경로·티켓 접두어가 바뀌고, 같은 값은 같은 별칭이다(같은 곳).
- [x] 시험: debug 스위치가 재시작 없이 다음 줄부터 반영된다(`packages/log/src/logger.test.ts`, web·worker·mcp 셋).
- [x] 화면 스크린숏과 UI 리뷰(PR 본문).

## 한 것

- **debug 스위치**: 설치 홈의 `<home>/logging.json`(`{"debug": true}`, 0600)에 둔다. power.json처럼 설치 설정 파일이라 DB 열을 더하지 않았다. `setupProcessLog`의 로거가 줄마다 파일의 inode·mtime·크기를 보고 바뀌었을 때만 다시 읽어, web·worker·mcp가 재시작 없이 다음 줄부터 debug를 따른다. 꺼져 있으면 `GANGER_LOG_LEVEL`을 따른다.
- **Settings 「로그와 진단」 구역**: 로그 크기(로그 폴더 전체), 로그 폴더, 자세한 로그 스위치, 진단 묶음 만들기. 로그 지우기 버튼은 없다. `GANGER_HOME`이 없는 서버(`pnpm dev`)에서는 크기·폴더 대신 쓰지 않는다고 알리고 스위치를 잠근다. 진단 묶음은 홈이 없어도 로그 없이 만든다.
- **로그 폴더 열기 기준**: 데스크톱 앱이 로컬 모드(이 기기에서 서버를 띄웠거나 이 기기의 서비스에 붙음)일 때만 「폴더 열기」를 보인다. 앱이 `gangerDesktopLogs` 다리로 열 수 있는지 알려 주고, 여는 경로는 앱이 아는 자기 홈의 `logs`라 페이지가 경로를 넘기지 않는다. 브라우저와 원격 모드에서는 서버 기기의 폴더를 열 수 없으므로 경로와 「경로 복사」만 보인다. 경로는 홈을 `~`로 줄여 보이고 복사는 전체 경로다.
- **진단 묶음**: `GET /api/diagnostics`(`anonymize=0`, `run=<id>`)가 zip을 돌려준다. `summary.json`(버전·Node·OS·실행 방식·프로세스 생존(로그의 마지막 생존 줄)·DB·WAL 크기·마이그레이션 상태·로그 폴더 파일 크기), `settings.json`(비밀과 주소를 뺀 요약), `runners.json`, `runs.json`(최근 50), `webhooks.json`(최근 100), `run-timeline.json`(고른 런), `server-logs.jsonl`(warn 이상 7일 + info 최근 500줄), `process-report.json`(`process.report` 요약, 환경 변수 제외). 이름은 `ganger-diagnostics-YYYYMMDD-HHmm-<6자리 16진>.zip`. 모든 문자열은 로그 가리기를 한 번 더 거친다.
- **익명화**(기본 켬): ssh 대상 → `ssh-target-N`, 호스트·tailnet 주소(`*.ts.net`, 100.64/10)·이 기기 이름·웹·webhook 주소 호스트 → `host-N`, 러너 이름 → `runner-N`, 홈 경로(`/Users/*`, `/home/*`, `GANGER_HOME`) → `~`·`<ganger-home>`, 티켓 키 접두어 → `PROJn`. 묶음 하나 안에서 같은 값은 같은 별칭이다. 화면은 「공개하기 전에 파일을 직접 열어 확인해 주세요」를 만들기 버튼 설명으로 보인다.
- **브라우저 오류**: `window` error·unhandledrejection과 루트 오류 화면이 잡은 오류를 서버 함수 하나(`reportBrowserError`)로 보내 web 로그에 `browser.error` error 줄로 남긴다. 페이지마다 서로 다른 오류 10개, 서버는 분당 30줄까지. 메시지·스택은 로그 가리기를 거친다.
- **데스크톱 메뉴**: 서버 메뉴(트레이 포함)에 「진단 묶음 만들기…」. 열린 서버에서 가린 묶음을 내려받고, 저장하면 공개 전에 확인하라는 대화상자를, 실패하면 다시 하라는 대화상자를 띄운다. 취소하면 아무것도 띄우지 않는다.

## 남긴 것

- 데스크톱 메뉴의 진단 묶음은 기본값(가리기 켬, 런 타임라인 없음)으로만 만든다. 런을 고르려면 Settings에서 만든다.
- 진단 묶음의 「프로세스 생존」은 로그의 마지막 생존·시작·정지 줄로 본다. 로그를 쓰지 않는 개발 실행에서는 비어 있다.

## 머지 위험

설치 설정에 debug 스위치 열을 더하면 one-way. 없으면 two-way.

DB 열을 더하지 않고 설치 홈의 `logging.json`에 두었다. two-way다. 되돌리면 파일이 남아도 아무도 읽지 않는다.
