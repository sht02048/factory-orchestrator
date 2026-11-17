# Orca 런 계약 검증: 런 시작과 진행 감지

조사일 2026-11-17. 티켓 0010. 스펙 10절 2, 3, 4, 5, 8번을 실제 런으로 확인한다. Runner 어댑터의 `startRun`, `pollRun`과 worker의 종료·입력 기다림 감지가 기댈 사실이다.

출처 표시는 research 0002를 따르고 하나를 더한다.

- **[실행]** 테스트 러너에서 직접 돌린 명령의 결과. macOS(arm64) 러너, Orca 1.4.258, 오케스트레이터 기계에서 비대화형 `ssh <host> '<command>'`로 실행했다.
- **[스키마]** `orca <command> --help`와 `orca agent-context --json`.
- **[소스]** 러너에 설치된 Orca 앱 번들의 JavaScript(`Orca.app/Contents/Resources/app.asar`와 `app.asar.unpacked/out/`). 문서·스키마에 없는 열거값을 찾으려고 읽었다. 다음 버전에서 바뀔 수 있다.

티켓 0009와 같은 세션에서 버려도 되는 테스트 저장소에 워크트리 넷을 만들고 Claude Code(Haiku 모델)를 하나씩 짧게 띄웠다. 에이전트를 띄운 횟수를 줄이려고 0009와 같은 에이전트 실행을 함께 썼다.

| 워크트리 | 프롬프트                                                  | 이 문서에서 본 것                       |
| -------- | --------------------------------------------------------- | --------------------------------------- |
| W1       | 특수 문자·줄바꿈이 든 짧은 지시                           | `create` 출력, 인용 통과, 턴 끝, 종료 0 |
| W2       | 30,528바이트(400줄) 지시 + `AskUserQuestion`으로 질문하기 | 긴 프롬프트, 입력 기다림                |
| W3       | `kill -TERM $PPID` 실행                                   | 0이 아닌 종료(143)                      |
| W4       | `sleep 120` 실행                                          | 진행 중(`working`)                      |

러너의 GitHub 인증이 비대화형 세션에서 동작하지 않아([research 0003](0003-orca-runner-contract.md)) 에이전트에게 push·PR을 시키지 않았다. 확인이 끝난 뒤 워크트리와 브랜치를 모두 지웠다.

예시와 픽스처의 로컬 경로, 호스트명, 사용자명, 계정은 `<path>`, `<host>`, `<user>`, `acme`로 바꿨다. UUID는 가상 값이고, 같은 대상은 `fixtures/0004/` 파일끼리 같은 값을 쓴다(번호는 시간 순서가 아니다). research 0003의 `fixtures/0003/`과는 따로 바꿔 같은 런타임·워크트리라도 값이 다르고 번호가 겹치기도 하므로, 두 폴더의 픽스처를 한 테스트에 섞지 않는다. 시각은 실제 간격을 남긴 채 옮긴 값이다. 픽스처는 [`fixtures/0004/`](fixtures/0004/)에 있다.

## 요약

| #   | 항목                       | 결론                                                                                                                                                                                                      |
| --- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2   | `worktree ps` 열거값       | `agents[].state`, `programStatus.state`, `terminalVerdict`는 소스에서 닫힌 목록을 찾았다. 행 `status`는 닫힌 목록을 찾지 못했다                                                                           |
| 3   | 종료·종료 코드·입력 기다림 | 대화형 에이전트는 일을 마쳐도 스스로 끝나지 않는다(`state: done`). 끝나면 `agents[]`에서 빠지고 셸 터미널은 남는다. 종료 코드는 Orca가 주지 않는다. 입력 기다림은 `state: waiting`과 `agentWait`로 보인다 |
| 4   | `worktree create` 출력     | 전체 출력을 픽스처로 남겼다. `launch.outcome.handle`, `launch.prompt.outcome: "handed-to-terminal"`                                                                                                       |
| 5   | 프롬프트 길이와 인용       | 인자마다 작은따옴표로 인용하면 줄바꿈·특수 문자가 그대로 간다. `--prompt`는 30,528바이트까지 그대로 가는 것을 확인했다. ssh 명령 문자열은 약 256 KiB가 한계다. 30 KB~200 KB 프롬프트는 확인하지 않았다    |
| 8   | `--surface terminal` 진행  | terminal로 뜨고, `worktree ps`가 working·waiting·done을 보여 준다                                                                                                                                         |

## 4. `worktree create --agent --prompt --json` 출력

```
orca worktree create --repo id:<repoId> --name fo-verify-w1 --no-parent \
  --agent claude --model haiku --surface terminal --prompt '<프롬프트>' --json
```

종료 코드 0, 약 2초 걸렸다 **[실행]**. 전체 출력: [`worktree-create-agent.json`](fixtures/0004/worktree-create-agent.json). 어댑터가 쓸 필드만 옮긴다.

```json
{
  "ok": true,
  "result": {
    "worktree": {
      "id": "<repoId>::<path>/workspaces/sandbox/fo-verify-w1",
      "identity": {
        "key": "wt2:local:<instanceId>",
        "executionHostId": "local",
        "instanceId": "<instanceId>"
      },
      "instanceId": "<instanceId>",
      "repoId": "<repoId>",
      "projectId": "github:acme/sandbox",
      "hostId": "local",
      "path": "<path>/workspaces/sandbox/fo-verify-w1",
      "head": "<sha>",
      "branch": "refs/heads/acme/fo-verify-w1",
      "baseRef": "refs/remotes/origin/main",
      "createdWithAgent": "claude",
      "workspaceStatus": "in-progress",
      "linkedLinearIssue": null,
      "linkedPR": null
    },
    "lineage": null,
    "workspaceLineage": null,
    "crossStoreLineage": null,
    "launch": {
      "outcome": { "kind": "terminal", "handle": "term_<uuid>", "paneKey": "<tabId>:<leafId>" },
      "worktreeId": "<repoId>::<path>/workspaces/sandbox/fo-verify-w1",
      "receipt": {
        "mode": "terminal",
        "preferred": "terminal",
        "reason": "requested",
        "detail": "Started a terminal agent, as requested."
      },
      "prompt": { "delivery": "submit", "outcome": "handed-to-terminal" },
      "operationId": "<ms>-<hex>"
    }
  }
}
```

- `result.worktree.id`(`<repoId>::<path>`)가 `worktree ps` 행의 `worktreeId`와 같다. 런 레코드에는 이 값을 워크트리 참조로 둔다.
- `launch.outcome.handle`은 에이전트 터미널 핸들, `launch.outcome.paneKey`는 `worktree ps`의 `agents[].paneKey`와 같다. 핸들은 로그 꼬리(`terminal read`)와 멈추기(`terminal close`, [research 0003](0003-orca-runner-contract.md))에 쓴다.
- 워크트리 경로는 등록한 저장소 옆이 아니라 Orca가 관리하는 폴더(`<path>/workspaces/<repo>/<name>`, 폴더 이름이 `workspaces`다)에 생긴다.
- `--branch`를 주지 않으면 브랜치는 `<접두사>/<name>`이다. 이 러너의 접두사는 GitHub 계정 이름이었다. 런의 PR을 브랜치로 찾으려면(spec Q40) `--branch`로 이름을 정해 주는 편이 낫다.
- 응답을 잃었을 때 다시 보낼 `operationId`는 성공 응답에도 온다.

## 5. 프롬프트 길이와 ssh 인용

### 인용

프롬프트를 POSIX 작은따옴표 인용(`'` → `'\''`)으로 감싸 `ssh <host> "<orca> worktree create ... --prompt <인용한 프롬프트> --json"`로 보냈다. 원격 셸은 zsh다 **[실행]**.

W1 프롬프트(줄바꿈 3줄, 큰따옴표, 작은따옴표, 백틱, `$HOME`, 백슬래시 두 개, `!`, 한국어):

```
Test task. Do not push and do not open a PR.
Run exactly this Bash command: echo "a `b` $HOME 'c' \\ !x" > note.txt
Then reply DONE. 한국어 줄: 끝나면 멈춰요.
```

에이전트가 실행한 명령(`agents[].toolInput`)이 프롬프트의 명령과 글자 하나까지 같았고, 터미널에도 세 줄로 들어갔다 **[실행]**. 백틱 안의 `b`가 명령으로 실행된 것은 에이전트가 프롬프트대로 셸에 넘겼기 때문이다(전달은 그대로였다).

### 길이

- W2의 30,528바이트(400줄) 프롬프트는 끝까지 갔다. 에이전트 세션 기록의 첫 사용자 메시지가 마지막 줄로 끝났고, 에이전트는 마지막 줄의 지시대로 질문했다 **[실행]**.
- `--prompt`로 실제 보낸 것은 30,528바이트까지다. 그보다 긴 인자는 ssh 쪽 한계만 쟀다. 인자 하나의 길이를 바꿔 가며 `worktree set --comment <text>`를 ssh로 보냈다(에이전트를 띄우지 않으려고 `--prompt` 대신 썼다) **[실행]**.

| 인자 길이(바이트) | 결과                                      |
| ----------------- | ----------------------------------------- |
| 200,000           | 성공                                      |
| 255,000           | 성공                                      |
| 262,000           | `Connection reset by peer`, ssh 연결 끊김 |
| 1,100,000         | 로컬에서 `argument list too long`         |

255,000바이트 인자는 됐고 262,000바이트 인자는 원격 sshd가 연결을 끊었다. 명령 문자열에는 `orca` 경로와 다른 인자가 더 붙으므로, 문턱은 명령 문자열 전체 256 KiB(262,144바이트) 언저리로 본다(OpenSSH의 패킷 크기 한계로 보이나 정확한 값은 재지 않았다). 러너의 `ARG_MAX`는 1,048,576이라 ssh 한계가 먼저 온다. `worktree create`와 `agent launch`에는 파일·stdin 입력이 없으므로(0002 A.5), 한계는 프롬프트가 아니라 인용을 거친 원격 명령 문자열 전체의 바이트 수에 걸린다. 작은따옴표 하나는 인용하면 4바이트(`'\''`)가 되고 한국어 한 글자는 UTF-8로 3바이트다. 어댑터는 인용한 뒤의 명령 문자열 전체 바이트를 재고, 여유를 두어 200 KiB(204,800바이트)를 넘으면 런을 시작하지 않고 거절한다. 다만 30 KB를 넘는 프롬프트가 Orca 런타임과 에이전트 입력(붙여넣기)을 거쳐 그대로 가는지는 재지 않았으므로, 이 상한은 ssh 한계만 반영한다.

- `worktree ps`의 `agents[].prompt`는 200자로 잘리고 줄바꿈이 공백으로 바뀐다 **[실행]**. 긴 프롬프트(W2)는 Claude Code가 붙여넣기 블록으로 받아 `prompt`가 `<pasted_content id="...">`로 시작했다 **[실행]**. 어느 쪽이든 전달 확인에 쓸 수 없다.

## 2. `worktree ps` 열거값

| 필드                        | 소스의 목록 **[소스]**                        | 관측 **[실행]**                                                                                                               |
| --------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `agents[].state`            | `working`, `blocked`, `waiting`, `done`       | `working`, `waiting`, `done`                                                                                                  |
| `programStatus.state`       | `idle`, `working`, `done`, `blocked`, `error` | `working`, `done`, `blocked`, 없음(0002 첫판)                                                                                 |
| `programStatus.kind`        | `permission`, `question`, `auth`              | `question`                                                                                                                    |
| `terminalVerdict`           | `live`, `unverifiable`, `none`                | `live`, `none`(`none`은 0002 첫판 관측)                                                                                       |
| 행 `status`                 | 닫힌 목록 못 찾음                             | `active`, `working`, `permission`, `inactive`([research 0003](0003-orca-runner-contract.md))                                  |
| `sidebarStatus`             | 닫힌 목록 못 찾음                             | `active`, `working`(0002 첫판), `monitoring`, `done`, `permission`, `inactive`([research 0003](0003-orca-runner-contract.md)) |
| `agentWait`(`--agent-wait`) | -                                             | `null`, `{ "source": "hook", "since": <ms> }`                                                                                 |

출처:

- `agents[].state`: `shared/agent-status/contracts/agent-status-types.js`의 `AGENT_STATUS_STATES`.
- `programStatus`: `shared/program-status/protocol.js`의 `PROGRAM_STATUS_STATES`, `PROGRAM_STATUS_KINDS`. 터미널 프로그램이 OSC 7501로 알리는 상태다.
- `terminalVerdict`: `cli/worktree-ps-terminal-verdict.js`. `liveTerminalCount > 0`이면 `live`, `unverifiableTerminalCount`가 없거나 0보다 크면 `unverifiable`, 그 밖에는 `none`.
- 행 `status`: 앱 번들의 계산 함수는 에이전트 행이 있으면 `permission`(하나라도 권한·질문 대기) > `working` > `active` 순으로 고르고, 에이전트가 없으면 `working`·`permission`을 `active`로 바꾼다. 그 밖의 값은 바탕 상태를 그대로 넘겨 닫힌 목록을 찾지 못했다.

행 `status`와 `sidebarStatus`는 화면용 요약이다. 어댑터는 `agents[]`의 `state`·`programStatus`와 `terminalVerdict`로 판단한다. 소스에서 닫힌 목록을 찾은 필드도 다음 버전에서 값이 늘 수 있으므로, 모든 필드에서 모르는 값은 "진행 중"으로 다룬다(0002 A.6과 같다). `--agent-wait`를 주지 않으면 `agentWait` 키 자체가 없다 **[실행]**.

## 3. 끝남, 종료 코드, 입력 기다림

### 일을 마쳐도 에이전트는 끝나지 않는다

Claude Code를 terminal로 띄우면 대화형 TUI가 뜬다. 지시를 마치면 다음 입력을 기다릴 뿐 프로세스는 끝나지 않는다 **[실행]**(W1). 그때 행은 다음과 같다([`worktree-ps-done-live.json`](fixtures/0004/worktree-ps-done-live.json)).

```json
{
  "status": "active",
  "sidebarStatus": "done",
  "liveTerminalCount": 1,
  "terminalVerdict": "live",
  "agents": [
    {
      "state": "done",
      "mainAgent": { "state": "done" },
      "hasLivePty": true,
      "programStatus": { "state": "done" },
      "lastAssistantMessage": "DONE\n\n..."
    }
  ]
}
```

`state: done`은 "턴이 끝났다"는 뜻이지 프로세스 종료가 아니다. 에이전트는 이 상태로 사람의 다음 입력을 기다린다. GLOSSARY는 "에이전트 프로세스 종료로 Ended가 된다"고 두고 종료 코드로 정상·오류 종료를 가르는데(Q49·Q70), 대화형 에이전트는 스스로 프로세스를 끝내지 않는다. GLOSSARY·스펙의 정의와 맞지 않는 사실이라 운영자 결정이 필요할 수 있다. 티켓 0037(core 인터페이스) 전에 다음 중 하나를 정해야 한다.

- `agents[].state: done`이 일정 시간 유지되면 끝난 것으로 보고, 오케스트레이터가 에이전트를 멈춘다([research 0003](0003-orca-runner-contract.md)의 `terminal close`). 이때 종료 코드는 없다.
- 에이전트를 비대화형으로 띄워 일을 마치면 끝나게 한다. `worktree create --agent`는 "known TUI agent"를 띄우므로 Orca의 에이전트 설정이나 다른 실행 경로가 필요하다. 확인하지 않았다.

### 에이전트 프로세스가 끝났을 때

W1은 터미널에 `/exit`를 보내(`terminal send --text "/exit" --enter`) 끝냈고, W3는 에이전트가 자기 부모(에이전트 프로세스)에 `SIGTERM`을 보내 끝났다 **[실행]**. 두 경우 모두:

- 에이전트를 띄운 로그인 셸(zsh)이 터미널에 남는다. `liveTerminalCount: 1`, `hasAttachedPty: true`, `terminalVerdict: "live"`가 그대로다.
- 행의 `agents`가 빈 배열이 되고 `status`·`sidebarStatus`는 `active`다.
- 두 경우의 행이 같다. [`worktree-ps-after-exit-0.json`](fixtures/0004/worktree-ps-after-exit-0.json), [`worktree-ps-after-exit-143.json`](fixtures/0004/worktree-ps-after-exit-143.json).

그래서 0002 A.6의 후보 가운데 `liveTerminalCount: 0`·`terminalVerdict: "none"`은 에이전트 종료 신호가 아니다. 터미널을 닫은 경우에만 그렇게 된다([research 0003](0003-orca-runner-contract.md)). 에이전트 프로세스 종료의 신호는 "그 워크트리 행의 `agents`에서, 전에 본 그 에이전트(`create` 결과의 `launch.outcome.paneKey`)가 사라짐"이다. 에이전트를 본 적이 없는 `agents: []`는 끝남으로 보지 않는다. 상태가 에이전트 훅으로 들어오므로, `create` 직후 훅이 에이전트를 올리기 전이나 훅이 꺼진 러너에서는 에이전트가 돌아도 `agents`가 빌 수 있다. 이번 런에서는 `create` 뒤 약 15~20초 만의 첫 폴링에 에이전트가 있었고, 그 전 구간과 훅이 꺼진 경우는 확인하지 않았다.

### 종료 코드

`worktree ps`, `terminal list`, `terminal show`, `terminal read` 어디에도 에이전트 종료 코드가 없다 **[실행]**. `terminal read`의 `status`는 남은 셸 때문에 `running`이다.

남은 셸에 `echo "FO_EXIT=$?"`를 보내고(`terminal send --text ... --enter`) `terminal read`로 읽으면 종료 코드가 나온다 **[실행]**. W1(`/exit`)은 `FO_EXIT=0`, W3(`SIGTERM`)은 `FO_EXIT=143`이었다. 픽스처: [`terminal-read-exit-0.json`](fixtures/0004/terminal-read-exit-0.json), [`terminal-read-exit-143.json`](fixtures/0004/terminal-read-exit-143.json).

이 방법은 사용자 셸이 zsh·bash 같은 POSIX 셸이고, 에이전트가 끝난 바로 뒤 셸에 다른 명령이 들어가지 않았다는 전제에 기댄다. 터미널에 입력을 보내는 일이라 어댑터의 기본 경로로 삼기에는 약하다. 위의 "끝나지 않는다" 문제와 함께 티켓 0037에서 정한다.

### 입력 기다림

W2는 `AskUserQuestion`으로 질문하고 답을 기다렸다 **[실행]**. [`worktree-ps-waiting-question.json`](fixtures/0004/worktree-ps-waiting-question.json):

```json
{
  "status": "permission",
  "sidebarStatus": "permission",
  "agents": [
    {
      "state": "waiting",
      "toolName": "AskUserQuestion",
      "programStatus": {
        "state": "blocked",
        "kind": "question",
        "message": "answer: Red or blue? (Red · Blue)"
      },
      "agentWait": { "source": "hook", "since": 1790000160075 }
    }
  ]
}
```

- `agents[].state: "waiting"`, `programStatus.state: "blocked"`(`kind`로 권한·질문·인증을 가른다), `--agent-wait`의 `agentWait`가 함께 나왔다. 행 `status`는 이름과 달리 질문에도 `permission`이다.
- `terminal show --json`의 `result.terminal.agentWait`에도 같은 값이 있다 **[실행]**.
- 권한 프롬프트로 멈추는 경우는 보지 못했다. 이 러너의 Orca는 Claude Code를 `--dangerously-skip-permissions`로 띄웠다(터미널 미리보기의 실행 인자) **[실행]**. 이것이 Orca 기본값인지 러너 설정인지는 확인하지 않았다. 소스의 `kind`에 `permission`이 있으므로 같은 모양으로 올 것으로 본다.

Waiting for Input 판정은 `agents[].state`가 `waiting` 또는 `blocked`이거나 `programStatus.state`가 `blocked`일 때로 한다. `agents[].state: "blocked"`는 관측하지 못했지만 소스 목록에 있고, 권한 프롬프트처럼 관측하지 못한 경우에 올 수 있어 함께 넣는다. `agentWait`는 `--agent-wait`를 줄 때만 오므로 보조로 쓴다.

관측하지 못한 나머지 값은 다음처럼 다루는 것을 제안한다. 티켓 0037에서 정한다.

- `programStatus.state: "error"`: 에이전트가 스스로 알린 오류 상태다. 프로세스가 살아 있으면 Running으로 두고, 끝남 판정은 위 신호(행의 `agents`에서 빠짐)를 따른다.
- `terminalVerdict: "unverifiable"`: 런타임이 터미널 생사를 확인하지 못한다는 뜻이다. 런 상태를 바꾸지 않고 다음 폴링에서 다시 본다.

### 진행 중

W4는 에이전트가 `sleep 120`을 백그라운드로 띄운 상태였다 **[실행]**. [`worktree-ps-working.json`](fixtures/0004/worktree-ps-working.json): 행 `status: "working"`, `sidebarStatus: "monitoring"`, `agents[0].state: "working"`, `programStatus: { "state": "working", "message": "1 shell still running" }`. `mainAgent.state`는 `done`이었다. 에이전트의 턴은 끝났어도 띄운 셸이 돌면 `working`이다.

## 8. `--surface terminal`로 띄운 에이전트의 진행 감지

- `--surface terminal`을 주면 `launch.outcome.kind: "terminal"`, `receipt.reason: "requested"`로 terminal에 떴다 **[실행]**. chat(`structured`)으로 뜬 경우는 만들지 않았다.
- terminal 에이전트도 `worktree ps`의 `agents[]`로 진행이 보였다. working, waiting, done과 끝남(`agents`에서 빠짐)을 모두 관측했다(위 3절) **[실행]**.
- `agentWait.source: "hook"`이 보여 주듯 상태는 에이전트 훅으로 들어온다. Orca에는 `agent hooks status|on|off`가 있다 **[스키마]**. 훅이 꺼진 러너에서도 감지되는지는 확인하지 않았다. 온보딩의 러너 확인에서 `orca agent hooks status`를 볼 후보다.

## 어댑터 픽스처로 쓸 출력

### 로그 꼬리: `terminal read`

`terminal read --terminal <handle> --limit 60 --json`의 결과는 `result.terminal`에 `handle`, `status`(`running`), `tail`(줄 배열), `tailRows`(줄마다 `wrapped`, `trailingSpaces`), `truncated`, `limited`, `oldestCursor`, `nextCursor`, `latestCursor`, `returnedLineCount`, `source`가 있다 **[실행]**. `source`는 `stream`(터미널 출력 흐름)과 `screen`(화면 상태) 둘 다 왔다. `terminal-read-agent-done.json`은 `screen`이고, 에이전트 입력란에 미리 채워진 글자를 담은 `draft`(`"cat note.txt"`, 에이전트의 입력 제안으로 보인다)도 있었다. [`terminal-read-agent-done.json`](fixtures/0004/terminal-read-agent-done.json)은 W1이 일을 마친 직후다. 에이전트 TUI의 상태 표시 줄 몇 줄(러너의 플러그인과 요금제 표시)은 픽스처에서 뺐다.

- `tail`은 화면에 그려진 줄이라 TUI 장식(박스 문자, 구분선)이 섞인다. 마크다운 백틱처럼 TUI가 바꿔 그린 글자는 원문과 다르다.
- 터미널을 닫거나 워크트리를 지운 뒤에는 `tail`이 빈다([research 0003](0003-orca-runner-contract.md)). 런의 마지막 로그는 그 전에 읽는다.

### 터미널 입력: `terminal send`

[`terminal-send.json`](fixtures/0004/terminal-send.json)은 `/exit`를 보낸 결과다. `send.accepted`, `bytesWritten`, `prompt.stages: ["input_accepted"]`가 오고, `--wait-submit` 없이 보내면 "turn start was observed" 확인은 없다는 경고가 `warnings`에 온다 **[실행]**.

### 러너 쪽 프로젝트 목록

저장소를 `orca repo add --path <path> --json`([`repo-add.json`](fixtures/0004/repo-add.json))으로 등록하자 `project list`와 `project setups`에 바로 나왔다 **[실행]**. [`project-list.json`](fixtures/0004/project-list.json), [`project-setups.json`](fixtures/0004/project-setups.json).

- 프로젝트 id는 remote에서 정해진다: `github:acme/sandbox`.
- `repo add`로 등록한 setup은 `id`가 `repoId`와 같고 `setupMethod: "legacy-repo"`, `setupState: "ready"`다. 0002 A.4의 예시(`setupMethod: "cloned"`, `hookSettings` 있음)와 달리 이 setup 행에는 `hookSettings`가 없었다.

## 아직 모르는 것

1. 대화형 에이전트가 일을 마쳐도 끝나지 않는 문제를 어떻게 다룰지, 에이전트 결과의 정상·오류 종료를 무엇으로 정할지. 티켓 0037에서 정한다.
2. 비대화형 실행(일을 마치면 프로세스가 끝나는 실행)을 Orca로 띄울 수 있는지.
3. 권한 프롬프트로 멈춘 에이전트의 `worktree ps` 행. 이 러너는 권한을 묻지 않게 띄웠다.
4. chat(`structured`)으로 뜬 에이전트의 진행 감지. `--surface terminal`을 늘 주므로 1단계에는 필요 없다.
5. Codex 등 다른 에이전트의 상태 값. Claude Code만 띄웠다.
6. 에이전트 훅이 꺼진 러너에서의 진행 감지.
7. 행 `status`·`sidebarStatus`의 닫힌 목록.
8. `launch.outcome.kind`와 `launch.prompt.outcome`의 전체 값. `terminal`, `handed-to-terminal`만 관측했다. 0002 A.5가 적은 `structured`, `journaled`도 있으므로 닫힌 목록으로 다루지 않는다.
9. `create` 직후 에이전트가 `agents`에 오르기 전 구간의 길이, 훅이 꺼진 러너에서 `agents`가 비는지.
10. 30 KB~200 KB 프롬프트가 Orca 런타임과 에이전트 입력을 거쳐 그대로 가는지.
11. `terminal read`의 `source`가 `stream`과 `screen` 가운데 무엇으로 정해지는지. 같은 명령(`--screen` 없음)에서 둘 다 왔다.

## 픽스처

[`fixtures/0004/`](fixtures/0004/)의 파일은 실제 출력에서 값만 바꿨다. `worktree-ps-*` 파일은 `worktree ps --agent-wait --json` 결과에서 테스트 워크트리 행만 남기고 봉투를 다시 만들었다(`totalCount`는 남긴 행 수). `terminal-read-exit-*`는 받은 `tail`과 커서로 봉투를 다시 만들었다. 그래서 `terminal-read-exit-*`에는 실제 출력에 있는 `tailRows`가 없다.

| 파일                                | 상황                                           |
| ----------------------------------- | ---------------------------------------------- |
| `worktree-create-agent.json`        | `worktree create --agent --prompt --json` 전체 |
| `worktree-ps-working.json`          | 진행 중(백그라운드 셸)                         |
| `worktree-ps-waiting-question.json` | 질문하고 입력 기다림                           |
| `worktree-ps-done-live.json`        | 일을 마치고 프로세스는 살아 있음               |
| `worktree-ps-after-exit-0.json`     | 에이전트가 종료 코드 0으로 끝남                |
| `worktree-ps-after-exit-143.json`   | 에이전트가 종료 코드 143으로 끝남              |
| `terminal-read-exit-0.json`         | 남은 셸에서 읽은 종료 코드 0                   |
| `terminal-read-exit-143.json`       | 남은 셸에서 읽은 종료 코드 143                 |
| `terminal-read-agent-done.json`     | 일을 마친 에이전트의 로그 꼬리                 |
| `terminal-send.json`                | 에이전트 터미널에 `/exit` 보내기               |
| `repo-add.json`                     | 저장소 등록                                    |
| `project-list.json`                 | 러너 쪽 프로젝트 목록                          |
| `project-setups.json`               | 러너 쪽 프로젝트 setup 목록                    |
