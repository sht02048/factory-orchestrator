---
status: done
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

- [x] 시험: 회전본을 포함해 합친 순서, 거르기 조합, follow가 회전을 넘어 이어 읽음.
- [x] 시험: 깨진 줄(쓰다 죽은 줄)을 건너뛰고 나머지를 보인다.
- [x] 시험: 런 타임라인이 표마다 한 줄 이상을 시각순으로 합친다.
- [x] 시험: MCP 도구가 읽기만 하고 가린 값만 돌려준다.

## 한 것

- `@ganger/log`의 `readServerLogs`·`followServerLogs`(`packages/log/src/read.ts`): 회전본까지 합쳐 시각순, 같은 시각이면 파일 안 순서. 깨진 줄은 건너뛴다. follow는 inode로 회전을 알아채고 옮겨 간 파일의 남은 줄과 그 사이 회전본을 읽은 뒤 새 파일로 넘어간다.
- `ganger logs`(`apps/cli/src/logs.ts`): 사람에게는 `YYYY-MM-DD HH:MM:SS.mmm LEVEL [proc] msg 키=값` 한 줄, TTY이고 `NO_COLOR`가 없을 때만 수준에 색. `--json`은 저장된 줄 그대로. Linux에서 systemd unit 파일이 있으면 stderr에 journald 안내.
- `runTimeline`·`ticketTimeline`(`packages/db/src/run-timeline.ts`): 본문 글(질문·Permission 내용, 알림 제목·내용)은 담지 않는다. 제어 요청(멈추기·이어 하기)도 넣었다.
- MCP `get_server_logs`: 읽기 전용 표시, `limit` 기본 200·최대 1000. 런을 주면 그 런의 줄과 런 id 없는 그 티켓의 줄(webhook 등)을 준다. 파일에서 읽은 줄을 한 번 더 가린다. 로그 줄은 고정 키·문맥 id 키·숫자와 참거짓만 바깥에 두고, 나머지 문자열과 `err`(러너 stderr, 요청 경로·호스트 등)는 `external` 칸에 둔다. 런의 `startError`는 가린 뒤 `external` 칸에 둔다.

## ADR 0013 범위

stdio 하나(결정 1), DB와 파일을 직접 읽기(결정 2), 비밀 값 없음(결정 4), 남이 쓴 글은 `external`(결정 7) 안이다. 결정 3의 "읽기 도구는 화면 단위"와는 다르다. 서버 로그를 보는 화면이 없다. 운영자 결정 L5(2026-11-20)가 읽기 전용 MCP 도구를 정했으므로 그대로 열었다. 쓰기 기능은 더하지 않았다.

## 남긴 것

- GLOSSARY의 런 타임라인 항목은 `ganger logs`도 런 타임라인을 쓴다고 적었지만, 티켓의 할 일 1은 파일만 다룬다. `ganger logs`는 DB를 열지 않고 서버 로그만 보인다. 터미널에서 런 타임라인을 보이려면 후속 티켓이 필요하다.
- `ganger logs`와 `get_server_logs`는 거르기 전에 파일 전체를 읽는다. 기본 한도(10MB × 6개 × 4파일)에서는 괜찮지만 `GANGER_LOG_MAX_MB`·`GANGER_LOG_FILES`를 크게 올리면 느려질 수 있다.

- `ticketTimeline`과 MCP의 `ticketKey` 거르기는 티켓 키 하나로만 찾는다. 트래커 연결이 여럿이고 같은 키가 있으면 섞인다. `runId`로 읽으면 연결로 좁힌다.

- follow는 한 번 폴링하는 사이(500ms)에 회전본 개수를 넘게 회전해 따라가던 파일이 지워지면 그 사이 줄을 잃는다. 기본 한도에서는 거의 없다.
- `LogFilter`의 `runId`·`ticketKey`는 `@ganger/log`가 core에 기대지 않으려고 맨 `string`이다.

## 머지 위험

DB 마이그레이션 없음, two-way.
