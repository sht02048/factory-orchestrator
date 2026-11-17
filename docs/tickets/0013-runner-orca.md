---
status: todo
blocked_by: [0037]
---

# Runner 어댑터: runner-orca

## 목표

core의 `Runner` 인터페이스를 ssh로 원격 `orca`를 실행해 구현한다.

## 범위

- 이 티켓은 새 패키지 `packages/runner-orca`만 만든다(Q56). `packages/core`는 고치지 않는다. 검증 결과에 따른 인터페이스 변경은 0037이 먼저 한다.
- ssh 실행: 러너 설정의 ssh 대상과 orca 실행 파일 경로를 쓴다. 질문 답 본문 등 인자는 원격 셸에 맞게 이스케이프하고, 사양(티켓) 전달 방법은 research 0008의 제안(ssh stdin으로 러너의 파일에 올려 `--spec-file`로 넘김)에서 출발해 이 티켓에서 정한다(스펙 8절).
- `--json` 봉투(`ok`, `result`, `error.code`)를 경계에서 스키마로 파싱한다. 모르는 열거값은 열어 두고 모르는 런 상태는 Running으로 다룬다.
- 런은 Orca 오케스트레이션 명령으로 돌린다(ADR [0009](../adr/0009-run-via-orca-orchestration.md), research [0008](../research/0008-orca-orchestration-run.md) 「제안: Runner 어댑터 계약」). `worktree create --agent --prompt`로 시작하지 않는다.
  - 우편함 터미널: 러너마다 하나를 자동으로 만들고(`terminal create`), 사라졌으면 다시 만든다. 그 핸들을 `--from`으로 쓴다(Q82.1). 러너마다 오래 쓰는 오케스트레이션 Run 하나를 쓴다(Q82.7).
  - 시작: `orchestration worker-start --name <결정적 이름>`. 결과의 식별자와 워크트리, 러너에서 받은 실제 브랜치 이름을 돌려준다(Q82.6). 같은 이름으로 이미 시작한 런을 찾아 이어 붙일 수 있게 한다(0037 시작 멱등). 시작 명령이 실패했을 때 돌려줄 결과는 스펙 11절 질문 10의 답을 따르고, 답 전에는 정하지 않는다.
  - 진행 폴링: `task-list`·`worker-show`·`check --peek`·`worktree ps --agent-wait`로 질문, 권한 대기, 완료 보고(outcome), 보고 없이 사라짐(`lost` 등 escalation, 터미널 사라짐, 셸만 남고 에이전트가 사라짐), 워크트리 사라짐을 돌려준다. 메일은 소비하지 않는다(Q82.2·Q82.3·Q82.5·Q82.19).
  - 질문에 답하기(`reply`), 권한 거절(`deny`). 허용은 없다(Q82.3).
  - 에이전트 멈추기(`worker-stop`), 완료 보고 뒤 에이전트 닫기와 정리(`worker-release` → `worktree rm --force`, 브랜치는 남김), 로그 꼬리(`worker-read`, 놓기 전에 읽음).
- 상태 확인(스펙 9절의 러너 필수 조건: Orca 상시 서비스 설치 여부와 비대화형 ssh 세션의 GitHub 인증, Q43), 러너 쪽 프로젝트 목록. GitHub 인증은 러너에서 각 러너 쪽 프로젝트 저장소에 `git push --dry-run`으로 확인하고 프로젝트마다 결과를 돌려준다(Q82.15).
- ssh 실패는 오류 종류로 돌려준다. 5분 판단은 worker와 core가 한다.

## 완료 조건

- 0009·0010과 research 0008의 실제 출력 픽스처(로그 꼬리와 러너 쪽 프로젝트 목록 포함)와, 모자란 경우 이 티켓이 테스트 러너에서 새로 받은 출력으로 각 메서드의 파싱 테스트가 통과한다(성공, `ok: false`, 깨진 출력).
- 줄바꿈·따옴표·`$`가 든 질문 답이 이스케이프된 명령 문자열로 바뀌는 테스트가 통과한다.
- 우편함 터미널이 없거나 사라졌을 때 다시 만들고, 메일을 읽어도 소비하는 `check`를 부르지 않는다는 테스트가 통과한다.
- GitHub 인증 확인(core `RunnerHealth.prerequisites`의 항목 하나)이 `git push --dry-run`의 성공과 실패를 구분한다는 테스트가 통과한다(Q82.15). 인증 실패는 `online`을 바꾸지 않는다. 할당에서 빼는 것은 core와 worker가 한다(Q82.14).
- 테스트 러너에 직접 붙여 상태 확인과 러너 쪽 프로젝트 목록을 돌린 결과를 PR에 적었다(운영자 준비 필요, 0009와 같은 러너).
