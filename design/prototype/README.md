# HTML 시안

factory-orchestrator의 화면 방향을 잡으려고 만든 정적 시안이다. 빌드 도구, 프레임워크, 외부 CDN 없이 HTML, CSS, 바닐라 JS만 쓴다. 실제 기능 개발에 그대로 쓰지 않고, 방향을 정한 뒤 0003 디자인 시스템으로 옮긴다.

## 열어 보기

`index.html`을 브라우저로 바로 연다(`file://`로 열어도 된다). 로컬 서버가 편하면 이 폴더에서 `python3 -m http.server`를 실행하고 `http://localhost:8000`을 연다.

- 사이드바에서 화면을 오간다. 사이드바 아래 버튼으로 다크·라이트 모드를 바꾸며, 고른 값은 브라우저에 저장한다. 기본은 다크 모드다.
- 방향 안이 여러 개인 화면(Runs, Stats)은 아래 가운데의 전환 막대로 안을 바꾼다. 숫자 키 `1`–`3`, 좌우 화살표로도 바꿀 수 있고, 고른 안은 주소의 `?v=` 값으로 남는다.
- 목 데이터는 `data.js` 하나에 있다. 러너, 프로젝트, 티켓 키, 주소는 모두 가상 값(`runner-a`, `acme/web`, `ACME-123`, `example.com`)이다.

## 파일

| 파일 | 내용 |
| --- | --- |
| `styles.css` | 색(OKLCH), 간격, 반경, 타이포, 모션 토큰과 공용 컴포넌트 스타일 |
| `picker.css` | 방향 안 전환 막대. 비교용 도구라 시안 토큰을 쓰지 않는다 |
| `data.js` | 목 데이터(러너 3대, 티켓 19개, 런 17개, 14일 통계) |
| `app.js` | 공용 사이드바, 테마 전환, 상태 배지, 방향 안 전환 |
| `*.html` | 화면 7개 |

## 토큰

색은 모두 `styles.css`의 `:root`(다크)와 `:root[data-theme="light"]`(라이트)에 역할 이름으로 정의한다. 화면에서는 역할 이름만 쓴다.

- 배경: `--bg-canvas`, `--bg-sidebar`, `--bg-surface`, `--bg-raised`, `--bg-hover`, `--bg-selected`, `--bg-inset`
- 선: `--border-subtle`, `--border-default`, `--border-strong`. 다크는 불투명한 선, 라이트는 반투명한 선을 쓴다
- 글자: `--text-primary`, `--text-secondary`, `--text-tertiary`, `--text-disabled`, `--text-on-accent`
- 강조: `--accent`, `--accent-hover`, `--accent-text`, `--accent-soft`
- 상태: `--status-{merged|check|failed|running|queued}-{solid|soft|text}`, `--status-online-*`, `--status-offline-solid`

중립색은 강조색과 같은 색상각(260)에 채도를 조금 준 회색이다. 상태색은 Merged 보라, Human Check 호박색, Failed 빨강, 진행 중 하늘색, Queued 회색이다. 색만으로 구분하지 않도록 배지에 점 모양(Queued는 빈 원)과 글자를 함께 둔다. 텍스트는 다크·라이트 모두 WCAG AA(4.5:1) 이상이다.

## 화면과 의도

1. **Tickets** (`tickets.html`): Linear 티켓 목록. 트래커 상태를 그대로 보여 주고, 자동 할당 라벨(`factory`)이 붙은 티켓은 라벨을 강조색으로 표시한다. 할당 전 티켓은 `할당하기`, Failed로 끝난 티켓은 `다시 할당하기`, Human Check 티켓은 `PR 확인하기`가 행 끝에 나온다.
2. **Runs** (`runs.html`): Queued, 진행 중, 끝난 런을 한 화면에서 본다. 방향 안 3개.
   - **상태 칸반**: Queued / 진행 중 / Human Check / Merged / Failed 다섯 열. 운영자가 할 일(Human Check, Failed)이 열 하나씩 차지한다. 끝난 런이 쌓이면 열이 길어진다.
   - **러너 레인**: 러너마다 capacity 칸을 두고 진행 중인 런을 채운다. 빈 칸, Offline 러너, 러너별 Queued가 바로 보인다. 끝난 런은 아래 표로 내린다.
   - **타임라인 표**: 런 하나가 한 줄인 밀집 표에 08:00–14:30 막대를 붙인다. 언제 몰렸고 얼마나 걸렸는지 한눈에 보이지만 상태별 묶음은 약하다.
3. **Run 상세** (`run.html?id=1051`): 결과 설명과 다음 행동을 맨 위에 두고, 타임라인, 로그 꼬리, PR·CI 체크, 런 정보를 보여 준다. `id`를 바꾸면 Queued(1056), 진행 중(1052), Merged(1048), Failed(1049, 러너 연결 끊김 / 1045, 에이전트 오류)도 볼 수 있다.
4. **Runners** (`runners.html`): 러너마다 Online/Offline, capacity 사용량, 진행 중·Queued 런, 등록된 프로젝트와 매핑을 카드 하나로 보여 준다. Offline 러너는 마지막 응답 시각과 기다리는 런 수를 알린다.
5. **Stats** (`stats.html`): 최근 14일. 방향 안 3개.
   - **요약 대시보드**: 지표 5개, 날짜별 처리량(결과별 누적 막대), 결과 분포, 러너·프로젝트·에이전트별 표.
   - **비교 표**: 러너·프로젝트·에이전트별 수치를 한 표에 모두 펼친다. 어느 쪽이 Failed나 Human Check가 많은지 비교하기 좋다.
   - **리드 타임**: 할당부터 런이 끝날 때까지 걸린 시간에 집중한다. 날짜별 중앙값, 분포, 러너·프로젝트·에이전트별 p50–p90 범위.
6. **Settings** (`settings.html`): Mapping(Linear 프로젝트 → 러너 · 러너 프로젝트 · 에이전트), Auto-assign Label, 연결 정보. 연결 값은 서버의 환경 변수에서 읽고 화면에서는 확인만 한다.
7. **온보딩** (`onboarding.html`): 처음 설치한 사람이 따라가는 첫 실행 설정. Linear 연결(API 키, webhook 공개 방법: Tailscale Funnel / Cloudflare Tunnel / 리버스 프록시), GitHub 토큰, 첫 러너 등록과 ssh 연결 확인, 첫 Mapping, 완료의 5단계다. 단계 표시와 이전/다음 이동이 있다. `?step=3&ssh=fail`처럼 열면 특정 단계와 연결 실패 상태를 바로 볼 수 있고, 3단계의 `시안용 결과 보기`로 성공·실패를 바꿔 볼 수 있다.

## 결과 판정

런이 끝났을 때 PR이 병합됐으면 Merged, 열려 있으면 Human Check, PR이 없으면 Failed다(ADR 0004). Failed 사유는 에이전트 오류와 러너 연결 끊김 두 가지이고, 자동으로 다시 시도하지 않는다.
