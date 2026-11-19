---
status: done
blocked_by: []
---

# 0118 런 멈추기·재개(Paused)

## 목표

운영자가 런을 끝내지 않고 잠시 멈췄다가, 같은 자리에서 이어 가게 한다. 새 런 상태 `Paused`를 더한다.

## 운영자 결정(2026-11-19)

- **멈추기**: 그 런의 에이전트 세션을 멈춘다. 워크트리·브랜치·러너 자리(capacity)는 그대로 둔다. 런 상태는 `Paused`.
- **재개**: 같은 러너, 같은 워크트리, 가능하면 같은 에이전트 세션에서 이어서 진행한다. Running으로 돌아간다.
- **최대 실행 시간**: Paused 동안은 시계도 멈춘다. 재개하면 남은 시간부터 센다.
- **화면**: Paused 런은 Dashboard Running 칸에 그대로 두고 카드에 `Paused` 꼬리표와 "재개" 버튼을 단다. 처리할 일(To do)·알림·배지에는 넣지 않는다. 멈추기·재개는 Dashboard 카드 메뉴와 Run 상세 두 곳에 둔다. 멈추기는 확인을 거치지 않고(되돌릴 수 있다), 실패하면 이유를 보인다.
- `Paused`를 GLOSSARY에 더하고(Waiting for Input·Canceled와 다름), ADR 0010 상태 이름·색 표에 넣는다. 상태 전이 규칙(`packages/core`)과 DB 상태 값에 더한다.

## Orca에서 멈추고 잇는 방법

`orca orchestration --help`, `orca terminal send --help`, `orca orchestration worker-start --help`, `orca skills get orchestration`(recovery-and-cleanup 참고 포함)과 `packages/runner-orca`의 기존 명령으로 확인했다(Orca CLI, 2026-11-19).

- **멈추기: 에이전트 터미널에 Escape 한 번.** `orchestration worker-show --dispatch <id>`의 `terminal`로 에이전트 터미널을 찾고 `terminal send --terminal <handle> --text $'\x1b'`를 보낸다. Claude Code·Codex 모두 Escape가 지금 차례만 끊고 에이전트는 프롬프트에서 기다린다. 임시 터미널로 확인하니 Escape는 1바이트 그대로 가고, `--interrupt`는 Ctrl+C(0x03)를 보낸다. Ctrl+C는 두 번 닿으면 에이전트가 끝나므로 쓰지 않는다.
  - `worker-stop`은 쓰지 않는다. Dispatch를 닫고 에이전트 터미널을 끝내서(help: "Fence one Dispatch and stop its supervised agent terminal") 같은 대화로 이어 갈 수 없다. 취소에만 쓴다.
  - 에이전트가 이미 끝났거나(`liveness: exited`) 터미널이 없으면 멈추기는 `agent_not_running`으로 실패하고, 화면은 "러너에서 에이전트를 찾지 못했어요"를 보인다. `liveness: unverifiable`이면 `terminal show`로 터미널이 붙어 있을 때만 보낸다(Orca 안내: unverifiable만으로 끝났다고 보지 않는다).
- **재개(세션이 살아 있음): 같은 터미널에 이어서 하라는 말을 쳐 넣는다.** `terminal send --terminal <handle> --text "<이어서 하라는 말>" --enter`. 에이전트는 멈춘 프롬프트에서 같은 대화로 이어 가고, 처음 Dispatch·Task가 그대로라 완료 보고(`worker_done`)도 지금처럼 받는다. `orchestration send --to dispatch:<id>`는 "일하는 worker는 차례가 끝나면 받는다"는 큐 방식이라, 끊긴 프롬프트에 바로 닿는 `terminal send`를 골랐다.
- **재개(세션이 없어짐): 같은 워크트리에 새 에이전트 세션.** 에이전트가 죽었거나 러너가 재부팅돼 터미널이 없으면 `orchestration worker-start --from <mailbox> --run <run> --spec-file - --worktree id:<worktree> --agent <agent>`로 같은 워크트리에 새 worker를 띄운다. 프롬프트는 "앞 에이전트가 하던 작업을 멈췄으니 git 상태와 커밋 기록으로 어디까지 했는지 확인하고 멈춘 데서 이어서 끝내 달라"는 머리말 + 티켓 제목·본문이다(트래커에 닿지 않으면 키와 저장된 제목만). 기존 워크트리라 `--name`·`--repo` 같은 만들기 옵션은 쓰지 않는다(help: 만들기 옵션은 기존 워크트리에서 거부). 새 Dispatch·Task로 런의 에이전트 참조(`agent_ref`)를 바꾼다. `worker-start`가 ssh에 닿지 않거나 출력이 깨지거나 `ready`·`failed`가 아닌 상태로 끝나면 시작 결과를 모르는 것(`start-outcome-unknown`)으로 실패하고, 다음 재개는 `worker-list --run <run>`(없으면 run 필터 없이)에서 같은 워크트리의 다른 worker 가운데 살아 있다는 근거가 있는 것(`liveness: live`, 아직 뜨는 중인 `ready` 전 상태, 또는 터미널이 붙어 있음)을 먼저 찾아 그 세션을 이어 받는다. 근거 없는 옛 세션은 받지 않는다. 같은 터미널에 이어서 하라는 말을 보낸 뒤 응답을 잃어도 결과를 모르는 것으로 보고 다시 시도한다(같은 말이 한 번 더 가는 것은 해가 없다). 같은 워크트리에 에이전트 세션이 둘 생기지 않게 하려는 것이다. worker는 결과를 모르는 재개 요청을 끝내지 않고(요청 행에 `outcome-unknown`을 적어 worker가 다시 떠도 안다) 다음 바퀴에 다시 시도한다. 그 사이 러너가 끊겨 Disconnected가 돼도 요청은 남는다(그 사이 러너에 닿지 않아도 기다린다). 그 사이 취소가 오면 새로 띄우지 않고(`startIfGone: false`) 이미 뜬 세션만 이어 받아, 취소가 그 세션을 멈추게 한다.

## 설계

- **core**: `RUN_STATES`에 `paused`. 전이 `running → paused`, `paused → running | disconnected | ended`, `disconnected → paused`(멈춘 런이 다시 닿았을 때). `planRunControl(state, "pause" | "resume")`: 멈추기는 Running만, 재개는 Paused만. 취소는 Paused도 "에이전트 세션을 멈추고 끝내기". `decideTimeout`은 `pausedMs`를 빼고 세고 Paused면 보지 않는다(`countedRunMs`). `decideConnection`은 Paused도 5분 규칙을 따른다.
- **Runner 어댑터**: `pauseAgent(run)`, `resumeAgent(run, { agent, model?, message, restartPrompt })` → `{ agentRef, restarted }`. runner-orca는 위 명령, 가짜 어댑터(`FakeRunner`)는 `paused`·`resumes` 기록과 `failNextControl`.
- **DB**: `runs.paused_since`(Paused 동안 반드시 있고, Paused에서 넘어간 Disconnected 동안에도 남아 멈춤 시계를 이어 간다. 그 밖에는 비어 있다. CHECK로 강제), `runs.paused_ms`(지난 멈춤 합), `runs.pause_source`(멈춘 이유. 0118은 `operator` 하나이고, Paused인 동안 반드시 있고 Disconnected를 거쳐도 지키며 재개하면 비운다. 러너에서 멈춤·보고 없이 멈춤 같은 다른 값을 판정하는 일은 티켓 0120이 한다). 상태를 바꿀 때 `changeRunState`가 멈춘 시간을 쌓는다. 새 표 `run_control_requests`(런마다 한 줄: 멈추기/재개, 요청 시각, 끝난 시각, 실패 이유). 웹이 요청을 남기고(취소 요청 중이면 거절) worker가 처리한다. 취소 요청과 같은 모양이다.
- **worker**: 틱마다 `processRunControlRequests`가 감시보다 먼저 요청을 처리한다. 실패 이유는 `runner-unreachable`·`agent-not-running`·`runner-error`·`state-changed` 넷으로 남기고 화면이 한국어로 보인다. 감시(`watchActiveRuns`)는 Paused 런도 본다. 보고 없이 사라짐은 Paused로 두고(재개가 새 에이전트 세션을 띄운다), 완료 보고·워크트리 없음·취소는 지금 규칙대로 끝낸다. 시간 초과는 보지 않는다. ssh가 5분 닿지 않으면 Disconnected가 되고(멈춤 시계는 이어져 시간 초과로 끝나지 않는다), 다시 닿으면 이력에서 Disconnected 직전 상태가 Paused인지 보고 Paused로 돌아간다. PR·트래커 후속 처리(after-run)도 Paused 런을 다른 끝나지 않은 런처럼 본다.
- **웹**: 서버 함수 `controlRun({ runId, control })`. Dashboard Running 칸의 Running 카드 오른쪽 위 메뉴(`Menu variant="icon"`, `KanbanCard menu`)에 "멈추기", Paused 카드에 꼬리표 `Paused`, "{n}분째 멈춤", "재개하기" 버튼. 오른쪽 패널에도 같은 행동을 둔다. 요청 중이면 카드 아래 줄에 "멈추는 중"/"재개하는 중", 실패하면 카드 설명에 문제 색으로 "멈추지 못했어요. {이유}"(`detailTone="problem"`). 실패는 10분 동안만 보인다(그 뒤에는 지금 상태와 맞지 않을 수 있다). 요청이 처리될 때까지 2초마다 다시 읽는다. 요청을 남긴 뒤 메뉴·버튼이 사라지므로 포커스를 카드 버튼(패널에서는 상태 줄)으로 옮기고 결과는 토스트로 알린다. 늦게 온 실패는 Dashboard 토스트와 패널·Run 상세의 미리 둔 `role="status"` 줄로 알린다. 그사이 상태가 바뀌어 거절되면 토스트로 알리고 다시 읽는다. Run 상세 머리에 "멈추기"(보조)/"재개하기"(주) 버튼, 상태 줄 `role="status"`에 요청 중·실패 문구. 지나온 일에 "멈춤"·"재개". 카드 설명과 Run 상세 이유 첫머리에 멈춘 이유 한 줄(`operator`는 "멈췄어요")을 둔다. 실행 시간(Dashboard·Runs·Run 상세)은 멈춘 시간을 뺀다. 문장에서는 Paused 런을 "멈춰 둔 런"으로 써 Dashboard 요약의 "멈춘 런"(Failed·Disconnected)과 가른다.
- **브라우저 번들**: 화면이 쓰는 `RunControlView`·`availableRunControl`은 `@ganger/app/run-control-view`에 두고, DB를 읽는 `runControlOf`·`requestControl`은 `@ganger/app/run-control`에 둔다. 섞으면 `@ganger/db`(node 모듈)가 브라우저로 딸려 가 화면이 깨진다.
- **Runs**: 아래 줄 상태 칩에 Paused, 위 줄 묶음은 진행 중에 든다. 오른쪽 패널 설명 문장.
- **통계**: Stats는 끝난 런만 세므로 Paused 런은 들지 않는다. 리드 타임은 할당부터 끝날 때까지의 벽시계 시간이라 멈춘 시간도 든다(바꾸지 않는다).
- **MCP**: 쓰기 도구에 멈추기·재개를 더하지 않는다. 범위 밖(아래).

## 범위

- `packages/core`(상태·전이·시계·어댑터 인터페이스·가짜 어댑터), `packages/db`(스키마·마이그레이션·요청), `packages/runner-orca`, `apps/worker`, `packages/app`(Dashboard·Run 상세·Runs·Tickets·Runners 모델의 상태 목록), `apps/web`(Dashboard·Run 상세·Runs, 그리고 코디네이터와 정해 Tickets 패널의 다음 할 일 문장 하나), `packages/ui`(`StatusPill` `paused`, `Menu variant="icon"`, `KanbanCard menu`, `MoreIcon`, DESIGN.md·/ds·시험), `demo`(Paused 시드), GLOSSARY(Paused, 그리고 운영자가 승인한 Agent·Agent Session 나누기), ADR 0010.

## 범위 밖

- MCP 쓰기 도구(`pause_run`·`resume_run`): Settings의 MCP 도구 목록과 메시지가 다른 화면이라 따로 한다.
- 모바일 앱·데스크톱 알림: Paused는 알림 사건이 아니라 바꿀 것이 없다.

## 완료 조건

- 상태 전이 시험: Running → Paused → Running, Paused 중 취소, Paused 중 러너 Offline(Disconnected를 거쳐 Paused로), 멈출 수 없는 상태 거절.
- 최대 실행 시간 시험: 멈춘 동안 시계가 멈추고, 재개하면 남은 시간부터 센다.
- 어댑터 시험: 가짜 어댑터(멈추기·재개·새 에이전트 세션), runner-orca 명령 모양(Escape, `--enter`, 같은 워크트리 `worker-start`, 실패 코드).
- DB 시험: 멈춘 시간 쌓기, CHECK, 요청 받기·거절·완료.
- e2e: 가짜 어댑터로 Dashboard에서 멈추고 재개.
- 스크린숏: Running 칸의 Paused 카드, Run 상세 멈추기/재개, 400px.

## DB 마이그레이션과 되돌리기

`packages/db/drizzle/20261119122857_run_pause`가 `run_control_requests`를 만들고 `runs`에 `paused_since`·`paused_ms`·`pause_source`를 더하며, 상태 CHECK에 `paused`를 넣으려고 `runs`를 다시 만든다(SQLite는 CHECK를 바꿀 수 없다).

앞 버전은 모르는 마이그레이션이 적힌 DB로 시작하지 않는다(`migrate.ts`: "database has migrations this version does not know"). 그래서 되돌리는 길은 둘이다.

1. 올리기 전에 떠 둔 DB 백업으로 되살린다. 그 사이의 런 기록은 잃는다.
2. 기록을 지키려면 먼저 Paused 런을 모두 재개하거나 취소하고, 서버를 멈춘 뒤 SQLite에서 `runs`를 앞 CHECK(`paused` 없음)로 다시 만들고 `run_control_requests` 표와 `schema_migrations`의 `20261119122857_run_pause` 줄을 지운다. `paused_since`·`paused_ms`·`pause_source` 열은 앞 코드가 읽지 않아 다시 만들 때 빼면 된다.
