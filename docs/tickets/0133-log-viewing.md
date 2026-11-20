---
status: doing
blocked_by: [0132]
---

# 0133 서버 로그 보기: `ganger logs`, 런 타임라인, MCP 읽기 도구

## 목표

운영자와 코딩 에이전트가 파일 위치를 몰라도 서버 로그를 런·티켓 단위로 읽는다. 스펙 [0004](../spec/0004-server-logs.md), 운영자 결정 L4·L5·L12.

## 할 일

1. `ganger logs`: 네 파일과 회전본을 합쳐 시각순으로 보인다. `--proc`, `--run <id>`, `--ticket <key>`, `--level`, `--since`, `-f`(follow), `--json`(원본 줄). 사람에게는 색 입힌 한 줄(TTY일 때만 색), `--json`은 그대로. systemd 서비스면 stdout이 journald에 있다는 안내.
2. 런 타임라인 읽기 함수(`packages/db`): `runs` 시각·`startError`·`unreachableSince`, `run_state_changes`, 그 티켓의 `tracker_events`, `mcp_actions`, `notification_events`, 질문·Permission·취소 요청을 `at` 순으로 합친다. 새 표를 만들지 않는다. `change_events`는 쓰지 않는다.
3. 읽기 전용 MCP 도구: 입력 `runId` 또는 `ticketKey`(없으면 최근 warn·error). 출력은 런 타임라인과 그 런의 서버 로그 줄(최대 N줄). ADR 0013의 범위 안인지 확인한다.
4. README(영어)에 로그 위치와 `jq` 예시 셋.

## 완료 조건

- [ ] 시험: 회전본을 포함해 합친 순서, 거르기 조합, follow가 회전을 넘어 이어 읽음.
- [ ] 시험: 깨진 줄(쓰다 죽은 줄)을 건너뛰고 나머지를 보인다.
- [ ] 시험: 런 타임라인이 표마다 한 줄 이상을 시각순으로 합친다.
- [ ] 시험: MCP 도구가 읽기만 하고 가린 값만 돌려준다.

## 머지 위험

DB 마이그레이션 없음, two-way.
