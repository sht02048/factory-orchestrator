---
status: todo
blocked_by: []
---

# 0076 제품 이름을 Ganger로 바꾸는 결정

## 목표

제품 이름을 Factory Orchestrator에서 **Ganger**로 바꾸고, 이름이 들어가는 모든 자리의 새 이름을 ADR로 먼저 정한다. 실제로 바꾸는 일은 0077~0079가 한다.

## 배경

운영자 결정(2026-11-18): 0.1.0 공개(0031) 전에 브랜딩을 Ganger로 바꾼다. 공개 뒤에 바꾸면 설치 폴더·패키지·저장소 링크를 두 번 옮겨야 한다. 범위는 제품 이름, 코드·패키지 이름, 앱 아이콘·로고, GitHub 저장소 이름 전부다.

2026-11-18 기준 옛 이름이 들어간 곳(저장소 추적 파일 약 240개): `@factory/*` 패키지 이름(core·db·ui가 가장 많다), `factory-orchestrator` 약 50개 파일, 설치 폴더 `~/.factory-orchestrator` 약 17곳, 환경 변수 `FACTORY_HOME`·`FACTORY_TAILSCALE_CLI`·`FACTORY_WORKER_WAKE`·`FACTORY_DEV_DIR`·`FACTORY_DESKTOP_USER_DATA`·`FACTORY_SERVER_BUNDLE`. 0078을 시작할 때 다시 센다.

## 범위

새 ADR(`docs/adr/`)에 정한다.

- 화면·문서에 쓰는 제품 이름: Ganger(문서 제목, 창 제목, 메뉴 막대, 데스크톱 앱 이름).
- 패키지 범위 이름(예: `@ganger/*`), CLI 명령 이름(예: `ganger`).
- 설치·데이터 폴더(예: `~/.ganger`)와 환경 변수 접두어(예: `GANGER_`).
- 데스크톱 앱 번들 ID, 앱 이름, 로그인 항목·로그 이름.
- **이미 설치한 곳 옮기기**: 옛 폴더·옛 환경 변수를 읽어 옮길지(한 번 옮기고 경고), 옛 이름을 언제까지 받을지. 저장 경로를 바꾸는 one-way 결정이다.
- 저장소 이름(예: `ganger`)과 바꾼 뒤 옛 주소에서 넘어오는 동작(GitHub의 자동 전달)에 기대는 범위.
- GLOSSARY·ADR 0005(공개 저장소·배포)에서 옛 이름을 쓰는 문장.

## 범위 밖

코드, 메시지, 아이콘 파일은 바꾸지 않는다(0077~0079).

## 완료 조건

- 위 항목마다 새 이름이 ADR에 하나로 정해져 있고, 옮기기 규칙이 적혀 있다.
