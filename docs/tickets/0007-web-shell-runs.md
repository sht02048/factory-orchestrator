---
status: todo
blocked_by: [0003, 0005]
---

# web 앱 셸과 Runs 화면

## 목표

시안 B의 앱 셸(사이드바, Workspace 전환기, 내비)과 Runs 화면을 DB에 있는 실제 런으로 띄운다. 얇은 경로의 화면 끝이고, 다른 화면 티켓은 이 셸 안에 라우트만 더한다.

## 범위

- 이 티켓은 `apps/web`만 고친다. 토큰과 컴포넌트는 `packages/ui`(0003)에서 쓴다.
- 앱 셸: 사이드바, Workspace 전환기, 홈·Tickets·Runs·Runners·Stats·Settings 내비(아직 없는 화면은 빈 자리), RUNNERS Online/Offline 점(ADR 0006·0007).
- Runs: 목록 + 오른쪽 상세 패널(ADR 0007). 열은 시안 B를 따르고 상태 필터(Queued, 실행 중, 입력 기다림, Ended 결과별)를 둔다. 패널에 상태, Queued 이유("맞는 러너가 Offline이라 기다리는 중" 등, Q65), 결과, Failed 사유, 러너, 에이전트, 경과 시간, PR을 보인다.
- 데이터는 server function으로 DB에서 읽는다.
- 화면 문구는 메시지 파일로 분리한다(ADR 0005). 이후 화면 티켓은 자기 화면 메시지만 고친다.
- 다른 화면 티켓이 앱 셸을 고치지 않게 내비 항목을 여기서 모두 둔다.

## 완료 조건

- 테스트 DB에 넣은 런(상태 넷, 결과 셋, Failed 사유 다섯)이 Runs 목록과 패널에 맞게 보인다는 테스트가 통과한다.
- Workspace를 바꾸면 그 Workspace의 런만 보인다는 테스트가 통과한다.
- 화면 문구가 컴포넌트에 직접 쓰이지 않았다(0003의 검사 통과).
