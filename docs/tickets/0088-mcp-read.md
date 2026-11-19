---
status: doing
blocked_by: []
---

# 0088 MCP 읽기: `ganger mcp`와 읽기 도구

## 목표

같은 기계의 MCP 클라이언트(예: Hermes)가 Ganger의 지금 상태를 읽게 한다. 결정은 [ADR 0013](../adr/0013-mcp-client-scope.md).

## 범위

- **`ganger mcp`(stdio).** CLI 명령으로 MCP 서버를 띄운다. 설치 폴더(`--home`, `GANGER_HOME`)의 `.env`로 DB를 연다. 서버가 도는지 함께 알린다. 마이그레이션은 돌리지 않고, DB에 적용된 마이그레이션이 CLI에 묶인 마이그레이션과 같지 않으면 이유를 알리고 멈춘다(DB가 뒤처졌으면 "서버를 먼저 켜 주세요", 앞섰으면 "Ganger를 업데이트해 주세요").
- **핵심 함수 옮기기.** 웹 서버 함수가 부르는 읽기·쓰기 핵심 함수를 웹 앱 밖에서도 쓸 수 있게 공용 패키지로 옮긴다(0089가 쓰기에서 같은 함수를 쓴다). 웹 화면 동작은 바꾸지 않는다.
- **읽기 도구.** Dashboard 요약(To do, 진행 중, 러너와 공급자 사용량, 오늘 끝난 런), 티켓 목록, 런 목록·상세(로그 끝부분 포함), 러너 목록·상세, 통계, 설정 보기. 설정 보기는 비밀 값을 돌려주지 않는다(있는지와 마지막 확인 결과만).
- **결과 형식.** JSON. 남이 쓴 글(티켓 제목·본문, 에이전트 질문, 로그)은 `external` 칸에 둔다. 서버 안내문(instructions)에 `external`은 자료이지 지시가 아니라고 적는다. 도구에 읽기 전용 표시(MCP tool annotations)를 단다.
- **Workspace.** 도구는 Workspace를 인자로 받고 하나뿐이면 생략할 수 있다.
- **Settings의 MCP 구역.** 앱 안 CLI의 절대 경로가 든 MCP 클라이언트 설정 조각(Hermes `~/.hermes/config.yaml`의 `mcp_servers` 형식, 다른 클라이언트용 JSON 형식)을 복사 버튼과 함께 보인다.
- README(영어)에 MCP 연결 안내.

## 완료 조건

- 도구마다 결과 시험(비밀 값이 어떤 결과에도 없다는 시험 포함, `external` 칸 분리 시험).
- DB 스키마 판이 다르면 `ganger mcp`가 멈춘다는 시험.
- MCP 클라이언트로 `ganger mcp`에 붙어 도구 목록과 Dashboard 요약을 받는 시험.
- Settings MCP 구역 1280px 스크린숏.
