---
status: todo
blocked_by: []
---

# 검증: Orca 런 시작과 진행 감지 계약

## 목표

Runner 어댑터의 런 시작·진행 폴링을 짓기 전에, 스펙 10절의 Orca 사실 중 런 시작과 종료·입력 기다림 감지에 걸린 것을 실제 런으로 확인해 `docs/research/`에 남긴다.

## 범위

- 스펙 10절 2, 3, 4, 5, 8번:
  - 2: `worktree ps`의 `status`, `agents[].state`, `programStatus.state`, `terminalVerdict` 열거값
  - 3: 에이전트 프로세스 종료의 가장 믿을 만한 신호, 에이전트 종료 코드를 읽는 방법(Q49 에이전트 오류), 입력 기다림 신호(`--agent-wait`의 `agentWait`, Q52)
  - 4: `worktree create --agent --prompt --json`의 실제 출력 전체
  - 5: `--prompt` 길이 제한과 줄바꿈·특수 문자의 ssh 인용 통과
  - 8: `--surface terminal`로 띄운 에이전트의 진행 감지
- Runner 어댑터(0013)가 픽스처로 쓸 출력도 함께 기록한다: 로그 꼬리(`orca terminal read`, research 0002 A.6)와 러너 쪽 프로젝트 목록(research 0002 A.4).
- 결과는 `docs/research/0004-orca-run-contract.md`에 쓴다. 실제 출력은 가상 값으로 바꿔 어댑터 테스트 픽스처로 쓸 수 있게 둔다.
- 운영자 준비가 필요하다: ssh로 닿는 테스트 러너, 버려도 되는 테스트 저장소, 에이전트(Claude Code 또는 Codex) 하나. 운영자 환경 값은 문서에 넣지 않는다(ADR 0005).

- 함께 도는 검증 티켓끼리 번호가 겹치지 않게 research 번호는 0004으로 정해 둔다. 픽스처는 `docs/research/fixtures/0004/`에 둔다.

## 완료 조건

- 다섯 항목마다 확인한 사실과 근거가 research 문서에 있고, 확인하지 못한 항목은 이유와 함께 남아 있다.
- 에이전트가 0으로 끝난 경우, 0이 아닌 코드로 끝난 경우, 입력을 기다리는 경우의 `worktree ps` 출력이 각각 하나 이상 기록돼 있다.
