# HTML 시안

Ganger의 화면 방향을 잡으려고 만든 정적 시안이다. 빌드 도구, 프레임워크, 외부 CDN 없이 HTML, CSS, 바닐라 JS만 쓴다. 실제 기능 개발에 그대로 쓰지 않고, 0003 디자인 시스템으로 옮긴다. 구조 결정은 ADR 0007에 있다.

## 열어 보기

`index.html`(홈)을 브라우저로 바로 연다(`file://`로 열어도 된다). 로컬 서버가 편하면 이 폴더에서 `python3 -m http.server`를 실행하고 `http://localhost:8000`을 연다.

- 사이드바 맨 위 전환기로 Workspace(Acme Commerce / Acme Labs / 전체)를 바꾼다. 고른 값은 브라우저에 저장한다. "전체"는 홈에서 모든 Workspace의 손댈 일만 모아 보여 준다.
- 목록에서 행을 누르거나 위아래 화살표로 고르면 오른쪽 패널이 바뀐다. 런 행은 두 번 누르거나 Enter로 Run 상세를 연다. 고른 행은 주소의 `?sel=` 값으로 남는다.
- 다크 모드만 있다.
- 실제 앱은 처음 들어오면 곧바로 온보딩이 뜨고, 설정을 마치기 전에는 다른 화면으로 들어갈 수 없다. 시안에서는 `onboarding.html`을 직접 연다.
- 목 데이터는 `data.js` 하나에 있다. 러너, 프로젝트, 티켓 키, 주소는 모두 가상 값(`runner-a`, `acme/web`, `ACME-123`, `example.com`)이다.

## 화면

| 파일 | 화면 |
| --- | --- |
| `index.html` | 홈. 손댈 일, 실행 중, Queued |
| `tickets.html` | Tickets. Linear 티켓, 할당, 마지막 런 결과 |
| `runs.html` | Runs. 전체 런과 상태 필터(`?f=todo` 등) |
| `run.html` | Run 상세. 결과와 이유, 타임라인, CI, 로그 꼬리(`?id=1051`, Failed는 `1049`·`1045`·`1040`) |
| `runners.html` | Runners. Online/Offline, capacity를 쓰는 런과 그 Workspace, 프로젝트 |
| `stats.html` | Stats. 14일 처리량, 결과 분포, 리드 타임, 러너·트래커 프로젝트·에이전트별 |
| `settings.html` | Settings. 이 Workspace / 설치 전체 |
| `onboarding.html` | 첫 실행 설정 6단계(`?step=3&check=fail`로 ssh 실패 상태) |

공용 파일은 `styles.css`(OKLCH 토큰과 공용 스타일), `app.js`(사이드바, Workspace 전환기, 목록 ↔ 패널 선택, 행·패널 렌더러), `data.js`(목 데이터)다.

## 원칙

1. 목록에서 고르면 오른쪽 패널에 상태, 이유, 러너, 에이전트, 경과 시간, PR·CI, 다음 행동이 바로 뜬다. 페이지를 옮기지 않고 훑고 판단한다.
2. 행은 정렬된 열이다. 제목이 가장 밝고 굵고, ID·러너는 흐리게, 숫자는 tabular-nums, 열 머리글은 작고 흐리게 둔다.
3. 색은 손댈 일에만 쓴다. Human Check는 주황, Failed는 빨강이고 나머지는 무채색과 포인트 파랑 하나다. 카드·배지 없이 옅은 선과 여백으로 나눈다.

## 요약 결과

런이 끝나면 에이전트 결과와 PR 상태 두 축을 기록하고, 요약 결과(Merged / Human Check / Failed)는 두 축에서 계산한다(ADR 0004, GLOSSARY). 에이전트가 스스로 끝났으면(정상 종료, 오류 종료) PR이 병합됨이면 Merged, 열림이면 Human Check, 없음·닫힘이면 Failed다. 에이전트 결과가 시간 초과, 입력 기다리다 멈춤, 러너 연결 끊김, 워크트리 없음, 운영자가 취소함이면 PR과 상관없이 Failed다. Failed가 된 까닭은 따로 저장하는 사유 없이 두 축으로 보이고, 자동으로 다시 시도하지 않는다. 계산 표는 [1단계 스펙](../../docs/spec/0001-phase-1.md) 4.2에 있다.

시안의 목 데이터에는 Failed 조합이 셋 있다(`data.js`의 `failCase`).

- 오류 종료 · PR 없음: 에이전트가 0이 아닌 종료 코드로 끝났고 런과 이어진 PR이 없다.
- 러너 연결 끊김 · PR 없음: 러너에 닿지 않은 채 최대 실행 시간이 지났다.
- 정상 종료 · PR 닫힘: 에이전트가 종료 코드 0으로 끝났고 런의 PR이 병합 없이 닫혔다.

Run 상태 표기는 GLOSSARY를 따른다. Running은 화면에서 "실행 중"으로 쓴다.
