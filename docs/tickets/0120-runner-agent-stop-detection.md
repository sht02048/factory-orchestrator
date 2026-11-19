---
status: done
blocked_by: [0118]
---

# 0120 러너에서 멈춘·막힌 에이전트를 Ganger가 알아채기

## 목표

러너에서 에이전트 세션이 멈추거나 막혀도 Ganger가 런을 계속 Running으로 보이던 문제를 고친다. 0118의 Paused·재개 위에 러너 쪽 신호를 읽는 판정만 더하고 새 구조를 만들지 않는다.

## 운영자 보고(2026-11-19, 실제 런)

서버가 맥북을 러너로 쓰는 중에 운영자가 맥북에서 Ganger 런의 에이전트 세션을 모두 중단했는데 Ganger는 아무것도 몰랐다.

- 한 런은 에이전트 세션이 러너에서 중단됐는데(Orca `worktree ps --agent-wait`의 에이전트 행 `interrupted: true`, `mainAgent.outcome: "cancellation"`) Ganger는 Running이었다.
- 한 런은 에이전트가 "Blocked: …" escalation을 보내고 완료 보고 없이 차례를 끝냈다. Orca가 "Worker stopped without reporting" escalation을 run 받은편지함에 올렸는데 Ganger는 Running이었다.
- 질문(`ask`)을 보낸 두 런은 Waiting for Input으로 맞게 보였다.
- 원인: `packages/runner-orca/src/progress.ts`가 escalation은 `stopReason`이 lost·exited·needs-input인 것만 보고, `worktree ps`의 에이전트 행은 수·터미널 수만 봤다.

## 운영자 결정(2026-11-19)

멈춘 런은 Running에서 빼지 않고 0118의 멈추기와 똑같이 `Paused`로 둔다(Running 칸, Paused 꼬리표, 재개 버튼, 최대 실행 시간 시계 멈춤, 러너 자리 유지, To do·알림·배지에 넣지 않음). 누가 멈췄는지만 카드·Run 상세에 한 줄로 다르게 보인다.

| 러너 쪽 신호                                         | Ganger 상태                 | 이유 한 줄                                  |
| ---------------------------------------------------- | --------------------------- | ------------------------------------------- |
| Ganger 멈추기(0118)                                  | Paused                      | 멈췄어요                                    |
| 에이전트 세션이 러너에서 중단됨                      | Paused                      | 러너에서 멈췄어요                           |
| 보고 없이 차례를 끝냄                                | Paused                      | 보고 없이 멈췄어요 + Run 상세에 마지막 출력 |
| 에이전트가 막혔다는 escalation(위 두 경우가 아닌 것) | Waiting for Input(Question) | 본문을 질문으로, 답은 그 dispatch로 보냄    |

재개는 0118과 같다. 러너에서 사람이 다시 일을 시켜 에이전트 행이 working이 되면 Ganger도 Running으로 돌린다.

## Orca 실제 출력(Orca 1.4.253, 2026-11-19)

`orca skills get orchestration`(recovery-and-cleanup 참고 포함), `worktree ps --help`, `orchestration send/ask/reply/inbox --help`와 이 맥의 실제 출력으로 확인했다. 보고된 두 런의 출력이 이 맥(그 러너)에 그대로 남아 있어 읽기만 했다. 견본은 가상 값으로 바꿔 `docs/research/fixtures/0120/`에 시험 입력으로 남겼다.

- **에이전트 행(`worktree ps --agent-wait --json`)**: 행마다 `paneKey`, `state`(working·done·blocked 등), `interrupted`, `stateStartedAt`(ms), `mainAgent { state, outcome?, stateStartedAt }`, `programStatus { state, message? }`, `hasLivePty`가 있다.
  - 러너에서 중단: `state: "done"`, `interrupted: true`, `mainAgent.outcome: "cancellation"`, `programStatus.state: "idle"`(`worktree-ps-agent-interrupted.json`). 시험 워커에 Escape를 보내니 곧바로 같은 모양이 됐다.
  - 차례 끝남: `state: "done"`, `interrupted: false`(`worktree-ps-agent-turn-ended.json`).
  - 뒤에서 셸이 도는 에이전트는 `mainAgent.state`가 done이어도 행의 `state`는 working이고 `programStatus.message: "1 shell still running"`이다(`worktree-ps-agent-background-shell.json`). 그래서 판정은 행의 `state`·`stateStartedAt`을 먼저 보고 없으면 `mainAgent`를 본다.
  - 다이얼로그가 열린 에이전트는 `state: "blocked"`다. 지금처럼 Running으로 둔다(권한 요청은 0008의 needs-input 길로 따로 온다).
  - 한 워크트리에 에이전트 행이 여럿일 수 있다(에이전트가 띄운 하위 worker). `paneKey`는 `terminal show`의 `tabId:leafId`와 같아서, 행이 여럿이면 런의 터미널로 `terminal show`를 불러 그 행을 고른다. 고를 수 없으면 모르는 상태다.
- **`worker-show`**: 중단된 런도 `state: "ready"`, `liveness: "unverifiable"`(이 맥에서 띄운 시험 워커는 `live`), `terminalState: "retained"`라 멈춤을 알려 주지 않는다. 판정에 쓰지 않는다.
- **escalation(`check --peek --full`·`inbox --full`)**:
  - Orca가 올리는 멈춤 알림은 id가 `msg_stop_`로 시작하고 `priority: "high"`, payload에 `stopReason`이 있다. `finished`("Worker stopped without reporting"), `errored`("Worker stopped on an error without reporting"), `needs-input`("Worker is waiting on a prompt"), `lost`·`exited`. 본문에 `Last output:` 다음 줄부터 마지막 출력이 있고, 끝에 `Full output: …` 줄이 붙기도 한다.
  - 보고에서 "payload에 stopReason 없음"이라 본 것은 `inbox`의 짧은 보기 때문이다. 짧은 보기는 payload에서 id만 남긴다(help: "keep only payload ids"). Ganger는 `--full`로 읽어 `stopReason`이 온다.
  - 에이전트가 직접 보낸 escalation은 id가 `msg_<hex>`이고 `priority: "normal"`, payload에 `taskId`·`dispatchId`만 있다.
  - Orca가 끝난 worker에게 메일을 전하지 못한 알림은 id가 `msg_followup_`로 시작하고 payload에 `reason`이 있다. 질문이 아니고, 에이전트가 답을 받지 못해 일하지 않는 것이라 보고 없이 멈춤으로 본다(막힘 질문에 답했는데 끝난 에이전트를 깨우지 못하면 Running으로 남지 않게 한다).
- **dispatch로 답 보내기**: `orchestration send --from <mailbox> --to dispatch:<id> --subject … --body …`의 결과는 `{ messageId }`다(`send-to-dispatch.json`). 시험 워커가 일하는 중에 보내니 차례가 끝난 뒤 받아 그 지시대로 완료 보고를 보냈다.

## 판정

- **보고 없이 멈춤 알아보기**: escalation 가운데 `stopReason`이 `finished`·`errored`인 것. `stopReason`이 없으면 id가 `msg_stop_`로 시작하는 것을 같은 알림으로 본다(보고처럼 짧은 보기나 이유 칸이 없는 Orca 판). id 접두사는 Orca 내부 규칙이라 바뀔 수 있다는 위험이 있다. 그래서 에이전트 행으로도 함께 판단한다. 알림이 없어도 에이전트 행이 질문·완료 보고 없이 done인 채 10분(`TURN_ENDED_PAUSE_AFTER_MS`) 이어지면 보고 없이 멈춤으로 본다. 그 경우 마지막 출력은 러너 로그 끝(`worker-read`)에서 읽는다.
- **러너에서 멈춤**: 에이전트 행이 working이 아니고 `interrupted: true`이거나 `mainAgent.outcome: "cancellation"`.
- **막힘 escalation → 질문**: escalation 가운데 `stopReason`·`reason`·`approval`이 없고 id가 `msg_stop_`·`msg_followup_`가 아닌 것. 본문(없으면 제목)을 질문으로, 질문 id는 `escalation:<메일 id>`다. 답은 `reply`가 아니라 `send --to dispatch:<런의 dispatch>`로 보낸다.
- **지난 신호 거르기**: Running 런은 마지막으로 Running이 된 시각(상태 이력의 `runningSince`)보다 뒤에 생긴 신호만 본다. Running에서 끊겼다 다시 닿아 Running이 된 이력은 기준으로 삼지 않고 그 앞 시각을 잇는다. 끊긴 동안 러너에서 멈춘 것을 놓치지 않으려는 것이다. Waiting for Input 등 다른 상태에서 끊겼다 Running으로 돌아온 이력(끊긴 동안 답한 경우)은 기준으로 삼는다. Orca 알림의 `created_at`은 초 단위라, 답을 보낸 직후 Orca가 올린 `msg_followup_`이 Running이 된 시각보다 앞서 보일 수 있다. 그래서 멈춤 알림은 기준 시각보다 5초(`STOP_NOTICE_SLACK_MS`) 앞선 것까지 새 신호로 본다. 재개하거나 질문에 답한 뒤에도 받은편지함에 남은 옛 알림과 옛 에이전트 행으로 다시 멈추지 않게 하려는 것이다. Paused 런은 멈춘 시각(`paused_since`)보다 뒤에 working이 된 행만 다시 시작한 것으로 본다. Ganger가 Escape를 보낸 직후 아직 working으로 남은 행으로 되돌아가지 않게 한다.
- **차례**: 완료 보고 > 보고 없이 사라짐(lost·exited, 지금처럼 끝냄) > 워크트리 없음 > 열린 질문·권한(Waiting for Input) > 러너에서 멈춤 > 보고 없이 멈춤. 에이전트가 막혔다고 escalation을 보내면 Orca가 곧이어 "보고 없이 멈춤" 알림도 올리는데, 열린 질문이 먼저라 Waiting for Input이 된다. 답을 보내면 Running이 되고 그보다 앞선 알림은 거른다.
- **모르면 Running**: 에이전트 행이 없거나 여럿인데 고를 수 없거나, 모르는 상태 값이거나, 시각이 없으면 지금처럼 Running으로 둔다.
- **Ganger가 멈춘 것과 가르기**: 판정은 Running 런에만 멈춤을 더한다. 운영자가 멈춘 런(`pause_source = operator`)은 이미 Paused라 러너 신호로 이유를 바꾸지 않는다. 멈춘 이유는 `runs.pause_source`(`operator`·`runner`·`unreported`)에 저장하고 Dashboard·Run 상세·MCP(`get_run`이 Run 상세 모델을 그대로 준다)가 같은 값을 쓴다. 알림 사건은 0118대로 Paused에 만들지 않는다.

## 위험

- **시계 차이**: 에이전트 행의 시각과 escalation의 `created_at`은 러너 시계, 마지막으로 Running이 된 시각·`paused_since`는 서버 시계다. 두 기기 시계가 크게 어긋나면 지난 신호를 새 신호로 보거나 그 반대가 될 수 있다. 보통 NTP로 초 단위라 실제 간격(분 단위)보다 작다.
- **id 접두사**: `stopReason`이 없을 때만 `msg_stop_` 접두사에 기댄다. Orca가 접두사를 바꾸면 그 경우는 10분 규칙으로만 알아본다.
- **운영자가 멈춘 런도 다시 working이면 Running**: 운영자가 멈춘 뒤 러너에서 사람이 일을 시키거나 dispatch에 쌓인 메일이 에이전트를 깨우면 에이전트가 실제로 일하므로 Running으로 돌린다. 일하는 런을 Paused로 두고 시계를 멈추는 것보다 실제 상태를 보이는 쪽을 골랐다.
- **올린 직후의 옛 escalation**: 이 버전을 올리면 진행 중인 런의 받은편지함에 남은, 아직 답하지 않은 막힘 escalation이 질문으로 올라온다. 보고된 런처럼 막혀 기다리는 런은 바로 질문이 되어야 해서 시각으로 거르지 않았다.
- **10분 규칙의 오판**: 에이전트가 뒤에서 일을 기다리느라 차례를 끝낸 채 10분 넘게 있으면 보고 없이 멈춤으로 보일 수 있다. 셸이 뒤에서 돌면 행이 working이라 해당하지 않는다. 다시 working이 되면 Running으로 돌아가고, 그동안 최대 실행 시간 시계만 멈춘다.

## 0118이 남긴 확인(실제 러너, Claude Code)

이 맥의 Orca 1.4.253에서 시험용 워크트리(`t0120-orca-probe`, 확인 뒤 지움)에 Claude Code(haiku) worker를 띄워 확인했다. 운영 중인 다른 런은 읽기만 했다.

- 멈추기: 일하는 중에 `terminal send --text $'\x1b'`를 보내니 `accepted: true, bytesWritten: 1`이고, 에이전트 행이 곧바로 `done`·`interrupted: true`·`outcome: "cancellation"`이 됐다. Orca는 이때 멈춤 escalation을 올리지 않았고 `worker-show`는 `liveness: live`, `state: ready` 그대로였다.
- 재개(같은 세션): `terminal send --text "멈춘 데서 이어서 해 주세요." --enter`를 보내니 행이 `working`·`interrupted: false`로 돌아왔고 에이전트가 같은 대화로 이어 갔다.
- dispatch로 보낸 지시: 위 `send --to dispatch:` 결과대로 차례가 끝난 뒤 받아 완료 보고를 보냈다.
- Codex는 이 맥에 설치돼 있지 않아 확인하지 못했다.

## 설계

- **core**: `PAUSE_SOURCES`에 `runner`·`unreported`. `RunProgress`의 active에 선택 칸 `activity`(`working`·`interrupted`·`turn-ended`·`unknown`과 그 시각)와 `unreportedStop`(시각, 마지막 출력). 판정 함수 `decideRunnerStop`(`runner-stop.ts`). 가짜 어댑터에 `interruptOnRunner`·`stopWithoutReport`·`continueOnRunner`.
- **db**: `pause_source` CHECK를 넓히는 마이그레이션 `20261119135223_run_pause_sources`(SQLite라 `runs`를 다시 만든다). 상태 이력에서 재개·답변·시작으로 Running이 된 마지막 시각을 읽는 `runningSince`.
- **runner-orca**: 위 스키마를 zod로 더 읽고(`worktree ps` 에이전트 행, `terminal show`의 `tabId`·`leafId`, payload `reason`, `send` 결과), `decideProgress`가 `activity`·`unreportedStop`·막힘 질문을 만든다. 막힘 질문의 답은 dispatch로 보낸다. 에이전트 지시서에 "막히면 escalation 대신 `ask --options`로 묻고, 질문이나 완료 보고 없이 차례를 끝내면 멈춘 것으로 본다"를 더했다.
- **worker**: `watchRun`이 끝내지 않는 런에 `decideRunnerStop`을 적용한다. Paused로 바꿀 때 이유를 남기고, 보고 없이 멈춤이면 마지막 출력을 `last_log`에 쓴다(알림에 없으면 러너 로그 끝).
- **app·web**: Run 상세 `status`의 paused에 `lastOutput`(보고 없이 멈춤일 때만). Run 상세에 "멈추기 전 마지막 출력" 블록을 접지 않고 둔다. 카드·Run 상세 이유 한 줄과 Dashboard 오른쪽 패널 설명이 이유별로 다르다. 메시지는 `domain.json`·`home.json`·`run.json`.
- **demo**: 러너에서 멈춘 런(ACME-25), 보고 없이 멈춘 런(ACME-26)을 시드에 더했다.
- GLOSSARY Paused 정의에 이유 셋과 escalation 다루기를 더했다.

## 범위

`packages/core`, `packages/db`, `packages/runner-orca`, `apps/worker`, `packages/app`(Run 상세 모델), `apps/web`(Dashboard 카드·패널, Run 상세, 그 메시지 파일), `demo`, `e2e`, GLOSSARY, `docs/research/fixtures/0120`.

## 범위 밖

- `needs-input` 가운데 승인(approval)이 없는 "Worker is waiting on a prompt" 알림: 지금처럼 Running으로 둔다. 무엇을 기다리는지 알 수 없어 따로 다룬다.
- Codex 실제 확인: 이 맥에 Codex가 없다.

## 완료 조건

- 판정 시험: 중단됨 → Paused, 보고 없이 멈춤(알림·10분 규칙) → Paused, 막힘 escalation → 질문, 다시 working → Running, 모르는 형식 → Running, 지난 신호 거르기.
- runner-orca 시험: 실제 출력 견본으로 에이전트 행·escalation 읽기, 행이 여럿일 때 `terminal show`로 고르기, 막힘 답을 dispatch로 보내기.
- worker 시험: 러너에서 멈춘 런의 재개, 시간 시계 멈춤, 마지막 출력 저장, 질문이 먼저.
- DB 시험: 새 이유 저장과 CHECK, `runningSince`.
- e2e: 가짜 어댑터로 러너에서 중단 → Paused 카드("러너에서 멈췄어요") → 재개.
- 스크린숏: Running 칸의 "러너에서 멈췄어요" Paused 카드, Run 상세의 "보고 없이 멈췄어요"와 마지막 출력, 400px.

## DB 마이그레이션과 되돌리기

`packages/db/drizzle/20261119135223_run_pause_sources`가 `runs`를 다시 만들어 `pause_source` CHECK에 `runner`·`unreported`를 넣는다. 열은 바뀌지 않는다.

앞 버전은 모르는 마이그레이션이 적힌 DB로 시작하지 않는다. 되돌리려면 올리기 전 백업으로 되살리거나, 서버를 멈추고 `pause_source`가 `runner`·`unreported`인 런을 `operator`로 바꾼 뒤(또는 재개·취소한 뒤) `runs`를 앞 CHECK로 다시 만들고 `schema_migrations`의 `20261119135223_run_pause_sources` 줄을 지운다.
