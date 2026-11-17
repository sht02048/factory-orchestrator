# Factory Orchestrator

Software factory의 관제탑. 트래커의 티켓을 러너에 맡기고, 러너의 에이전트가 티켓을 처리한 현황과 통계를 보여 준다.

## Language

### 일감

**Ticket**:
트래커에 있는 작업 단위 하나. 상태의 기준은 언제나 트래커다.
_Avoid_: Issue, Task, 이슈

**Tracker**:
티켓을 보관하는 외부 시스템. 1단계에서는 Linear만 지원한다.
_Avoid_: Ticket source, 이슈 트래커

### 실행

**Runner**:
티켓을 처리하는 실행 환경 하나. 1단계에서 러너는 ssh로 닿는 Orca 환경이며, 여러 개를 등록할 수 있다.
_Avoid_: Worker, Agent, Host, Machine

**Capacity**:
한 러너가 동시에 돌릴 수 있는 런의 최대 수.
_Avoid_: Slot, Concurrency

**Online / Offline**:
오케스트레이터가 러너에 닿는지 여부.

**Project**:
러너 안에 등록된 코드 저장소 하나. 한 러너는 여러 프로젝트를 가진다.
_Avoid_: Repo

**Worktree**:
프로젝트 안에서 티켓 하나를 처리하려고 만든 격리된 작업 공간.

**Run**:
티켓 하나를 러너에 맡겨 에이전트가 처리하는 한 번의 시도. 같은 티켓에 여러 런이 있을 수 있다.
_Avoid_: Job, Execution, Dispatch

**Agent**:
런 안에서 티켓을 수행하는 코딩 에이전트(Claude Code, Codex 등). 어떤 에이전트를 쓸지는 매핑이 정한다. 에이전트는 티켓 자체만 지시로 받는다.

**Assignment**:
티켓을 러너에 맡겨 런을 시작하는 일. 운영자가 직접 하거나 자동 할당이 한다.
_Avoid_: Dispatch

**Mapping**:
트래커의 프로젝트와 러너 쪽 프로젝트, 그리고 쓸 에이전트를 잇는 규칙. 티켓이 어디서 누구에게 처리될지 정한다.
_Avoid_: Route, Binding

**Auto-assign Label**:
티켓에 붙으면 운영자 없이 할당이 일어나게 하는 트래커 라벨.
_Avoid_: Trigger

**Queued**:
할당은 됐지만 맞는 러너에 남은 capacity가 없어 시작을 기다리는 런의 상태.
_Avoid_: Pending, Waiting

### 결과

**Pull Request**:
런이 만든 변경을 담은 PR. 모든 런의 변경은 PR을 거치며, 기본 브랜치에 직접 push하지 않는다.

**Human Check**:
런이 끝났는데 PR이 병합되지 않고 열려 있는 결과. 사람이 확인해야 한다.
_Avoid_: Review, Approval

**Merged**:
에이전트가 CI 통과를 확인하고 PR을 머지 커밋으로 직접 병합한 런의 결과.

**Failed**:
PR을 남기지 못하고 끝난 런의 결과. 사유는 에이전트 오류나 러너 연결 끊김이다. 자동으로 다시 시도하지 않는다.
_Avoid_: Error, Crashed

### 사람

**Operator**:
오케스트레이터 설치 하나를 운영하는 사람. 설치 하나에 운영자는 한 명이며, 1단계에는 다중 사용자 개념이 없다.
_Avoid_: User, Admin
