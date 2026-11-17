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

**Tracker Connection**:
오케스트레이터가 트래커 조직 하나에 닿는 연결(API 키, webhook). 설치 단위 자원이라 여러 개를 등록할 수 있고(예: 회사 Linear 조직과 개인 Linear 조직), 모든 Workspace가 함께 쓴다.
_Avoid_: Integration, Account

**Tracker Project**:
트래커 안에서 티켓을 묶는 프로젝트 하나(Linear 프로젝트). 운영자는 트래커 프로젝트를 골라 Workspace에 묶는다. 러너 쪽 코드 저장소인 Project와 다르다.
_Avoid_: Project(단독으로), Linear 프로젝트

**Workspace**:
운영자가 트래커 프로젝트 여러 개를 골라 묶은 단위. 트래커 조직(Linear 워크스페이스)과 1:1이 아니며, 어느 트래커 연결의 트래커 프로젝트든 골라 묶을 수 있다. 한 트래커 프로젝트는 Workspace 하나에만 속한다. 매핑은 Workspace 안에 있고, 러너와 트래커 연결은 Workspace 밖에 있다.
_Avoid_: Team, Org, Space, Organization

### 실행

**Runner**:
티켓을 처리하는 실행 환경 하나. 1단계에서 러너는 ssh로 닿는 Orca 환경이며, 여러 개를 등록할 수 있다. 러너는 어느 Workspace에도 속하지 않고 모든 Workspace가 공유한다.
_Avoid_: Worker, Agent, Host, Machine

**Capacity**:
한 러너가 동시에 돌릴 수 있는 런의 최대 수.
_Avoid_: Slot, Concurrency

**Online / Offline**:
오케스트레이터가 러너에 닿는지 여부.

**Project**:
러너 안에 등록된 코드 저장소 하나. 한 러너는 여러 프로젝트를 가진다. 트래커 쪽 프로젝트는 Tracker Project로 따로 부른다.
_Avoid_: Repo

**Worktree**:
프로젝트 안에서 티켓 하나를 처리하려고 만든 격리된 작업 공간. Orca가 workspace라 부르는 것이며, 이 저장소에서는 Workspace와 구분해 Worktree로만 부른다.

**Run**:
티켓 하나를 러너에 맡겨 에이전트가 처리하는 한 번의 시도. 같은 티켓에 여러 런이 있을 수 있다.
_Avoid_: Job, Execution, Dispatch

**Agent**:
런 안에서 티켓을 수행하는 코딩 에이전트(Claude Code, Codex 등). 어떤 에이전트를 쓸지는 매핑이 정한다. 에이전트는 티켓 자체만 지시로 받는다.

**Assignment**:
티켓을 러너에 맡겨 런을 시작하는 일. 운영자가 직접 하거나 자동 할당이 한다.
_Avoid_: Dispatch

**Mapping**:
Workspace 안에서 트래커 프로젝트와 러너 쪽 프로젝트·에이전트를 잇는 규칙. 티켓이 어디서 누구에게 처리될지 정한다. 러너는 고르지 않는다. 할당 때 그 러너 쪽 프로젝트가 있는 러너 중 Online이고 남은 capacity가 가장 많은 러너를 고른다.
_Avoid_: Route, Binding

**Auto-assign Label**:
티켓에 붙으면 운영자 없이 할당이 일어나게 하는 트래커 라벨.
_Avoid_: Trigger

**Run 상태**:
런의 상태는 Queued, Running, Waiting for Input, Disconnected, Ended 다섯이다. 할당된 런은 Queued로 시작하고(대기열 순서가 오고 남은 capacity가 있으면 바로 Running), Running·Waiting for Input·Disconnected를 오가다 Ended가 된다. Ended에만 에이전트 결과와 PR 상태가 붙는다.

**Queued**:
할당은 됐지만 아직 시작하지 않은 런의 상태. 대기열에서 앞 런이 시작하기를 기다리거나, 할당 때 정한 러너에 남은 capacity가 없거나, 맞는 러너가 모두 Offline이라 러너를 정하지 못한 경우다. 마지막 경우는 대기열 순서에서 빠져 뒤 런을 막지 않는다.
_Avoid_: Pending, Waiting(단독으로. Waiting for Input은 다른 상태다)

**Running**:
러너에서 에이전트가 티켓을 처리하고 있는 런의 상태. 화면에서는 "실행 중"으로 쓴다.

**Waiting for Input**:
에이전트가 권한 프롬프트 등에서 사람 입력을 기다리고 있는 런의 상태. 손댈 일에 올리며, 최대 실행 시간은 이 동안에도 흐른다. 에이전트가 다시 움직이면 Running으로 돌아간다. 화면에서는 "입력 기다림"으로 쓴다. capacity를 기다리는 Queued와 다르다.

**Disconnected**:
런 중 러너에 ssh가 5분 동안 계속 닿지 않는 런의 상태. 최종 실패가 아니다. 손댈 일에 올리고, 워크트리는 건드리지 않으며, capacity를 계속 차지한다. 다시 닿으면 실제 상태를 확인해 Running으로 돌아가거나 Ended가 된다. 최대 실행 시간은 이 동안에도 흐른다. 화면에서는 "연결 끊김"으로 쓴다.
_Avoid_: Offline(러너의 연결 여부이지 런의 상태가 아니다), Lost

**Ended**:
런이 끝나 에이전트 결과와 PR 상태가 붙은 상태. 에이전트 프로세스 종료, 최대 실행 시간 초과, 워크트리 사라짐으로 Ended가 된다.

### 결과

**Pull Request**:
런이 만든 변경을 담은 PR. 모든 런의 변경은 PR을 거치며, 기본 브랜치에 직접 push하지 않는다.

**에이전트 결과**:
Ended 런에서 에이전트 쪽이 어떻게 끝났는지. 런이 끝날 때 한 번 기록한다. 여섯 가지다.

- **정상 종료**: 에이전트가 종료 코드 0으로 끝났다.
- **오류 종료**: 에이전트가 0이 아닌 종료 코드로 끝났다.
- **시간 초과**: Running 중에 최대 실행 시간을 넘겨 오케스트레이터가 에이전트를 멈췄다.
- **입력 기다리다 멈춤**: Waiting for Input 중에 최대 실행 시간을 넘겨 오케스트레이터가 에이전트를 멈췄다.
- **러너 연결 끊김**: Disconnected인 채 최대 실행 시간이 지났다. 러너에 닿지 않아 에이전트를 멈추지 못했다.
- **워크트리 없음**: 런 중(Disconnected에서 다시 닿았을 때 포함) 워크트리가 사라졌다.

_Avoid_: 종료 사유, Exit status

**PR 상태**:
Ended 런에서 런과 이어진 PR이 런이 끝난 때 어땠는지. 없음, 열림, 병합됨, 닫힘(병합 없이) 넷이다. 런이 끝날 때 한 번 기록하고 바꾸지 않는다. 그 뒤 사람이 PR을 병합하거나 닫으면 **이후 PR 상태**로 따로 기록한다.

**요약 결과**:
에이전트 결과와 PR 상태에서 계산하는 Merged, Human Check, Failed 셋. 손댈 일 목록과 통계에 쓰려고 계산만 하고 따로 저장하지 않는다. 두 축이 같으면 언제 계산해도 같다.
_Avoid_: 판정 결과(저장하는 값처럼 들린다)

**Human Check**:
에이전트가 종료 코드와 상관없이 스스로 끝났고(정상 종료, 오류 종료) PR이 열려 있는 요약 결과. 사람이 확인해야 한다. 그 뒤 PR이 병합되거나 닫혀도 요약 결과는 바뀌지 않고, 이후 PR 상태로 따로 기록한다.
_Avoid_: Review, Approval

**Merged**:
에이전트가 스스로 끝났고(정상 종료, 오류 종료) PR이 병합된 요약 결과. 에이전트가 CI 통과를 확인하고 PR을 머지 커밋으로 직접 병합한 경우다.

**Failed**:
Merged와 Human Check가 아닌 모든 요약 결과. 에이전트 결과가 시간 초과·입력 기다리다 멈춤·러너 연결 끊김·워크트리 없음이거나, 에이전트가 스스로 끝났는데 PR이 없거나 닫혔다. 왜 Failed인지는 두 축으로 보이며 따로 저장하는 사유는 없다. 자동으로 다시 시도하지 않는다.
_Avoid_: Error, Crashed, Failed 사유(저장값처럼 들린다. 두 축으로 말한다)

### 사람

**Operator**:
오케스트레이터 설치 하나를 운영하는 사람. 설치 하나에 운영자는 한 명이며, 1단계에는 다중 사용자 개념이 없다.
_Avoid_: User, Admin
