# 비대화형 에이전트 실행 검증: Orca 터미널에서 끝남과 종료 코드

> 이 방식은 채택하지 않았다. 운영자가 Q82를 고쳐 대화형 에이전트를 Orca 오케스트레이션으로 맡기기로 했다(Q82 개정, [ADR 0009](../adr/0009-run-via-orca-orchestration.md), [research 0008](0008-orca-orchestration-run.md)). 이 문서는 그 결정의 근거 기록으로만 남긴다.

조사일 2026-11-17. 티켓 없음. [research 0004](0004-orca-run-contract.md)의 "아직 모르는 것" 1, 2번을 보강한다. 대화형 TUI 에이전트는 일을 마쳐도 끝나지 않고 종료 코드도 없어서([research 0004](0004-orca-run-contract.md) 3절), 운영자는 에이전트를 비대화형(한 번 실행하고 끝나는 모드)으로 띄우는 방식을 골랐다(운영자 결정 Q82, 2026-11-17. 코디네이터 대화에서 정했고 spec에는 아직 기록하지 않았다). 이 문서는 그 방식이 Orca 러너에서 되는지, 런의 끝·종료 코드·프롬프트 전달을 어떻게 얻는지 확인한다.

출처 표시는 research 0004를 따른다.

- **[실행]** 테스트 러너에서 직접 돌린 명령의 결과. macOS(arm64) 러너, Orca 1.4.258, Claude Code 2.1.326, 오케스트레이터 기계에서 비대화형 `ssh <host> '<command>'`로 실행했다.
- **[스키마]** `orca <command> --help`, `orca agent-context --json`, `claude --help`.
- **[소스]** 러너에 설치된 Orca 앱 번들의 JavaScript(`app.asar.unpacked/out/`). 다음 버전에서 바뀔 수 있다.

research 0004와 같은 버려도 되는 테스트 저장소에 워크트리 하나(`fo-headless-h1`)를 에이전트 없이(`worktree create`에 `--agent` 없음) 만들고, 그 안에 `orca terminal create --command`로 터미널을 다섯 번 띄웠다. 에이전트가 모델을 부른 것은 A1b, A2 두 번이고 모델은 Haiku다.

| 실행 | `--command`에 넣은 명령(요약)                                                                  | 이 문서에서 본 것                                  |
| ---- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| E1   | `claude --fo-bogus-flag; echo __FO_EXIT__=$?`                                                  | 모델 호출 없이 인자 오류로 낸 종료(1), 셸은 남음   |
| E2   | `sh -c 'exit 7'; c=$?; echo __FO_EXIT__=$c; printf %s $c > <runDir>/exit-code; exit $c`        | 셸까지 끝냈을 때 Orca가 보여 주는 것               |
| A1   | `claude -p ... --allowedTools Write "$(cat <runDir>/prompt.md)" ...`                           | `--allowedTools`가 프롬프트를 삼킴. 모델 호출 없음 |
| A1b  | `claude -p ... --allowedTools Write < <runDir>/prompt.md > <runDir>/a1-out.json ...`           | 정상 종료(0), 권한 거절, `worktree ps` 진행        |
| A2   | `claude -p ... --max-turns 1 --allowedTools Write -- "$(cat <runDir>/prompt.md)" ...; exit $c` | 에이전트가 낸 0이 아닌 종료(1), 셸 종료            |

`<runDir>`은 러너 홈 아래 워크트리 밖에 만든 임시 폴더다. 검증을 시작할 때 러너의 GitHub 인증이 비대화형 ssh에서 동작하지 않아 push·PR은 하지 않았다. 검증 중에 운영자가 `gh auth login --insecure-storage`와 `gh auth setup-git`으로 고쳤다([research 0003](0003-orca-runner-contract.md) "러너의 GitHub 인증"). 에이전트가 push·PR까지 하는 런은 돌리지 않았다. 확인이 끝난 뒤 터미널, 워크트리, 브랜치, `<runDir>`을 모두 지웠다.

예시와 픽스처의 로컬 경로, 호스트명, 사용자명은 `<path>`, `<runDir>`, `<host>`, `<user>`로 바꿨다. 저장소 이름은 research 0004처럼 `sandbox`로 썼다. UUID는 가상 값이고 같은 대상은 `fixtures/0007/` 파일끼리 같은 값을 쓴다. research 0003·0004의 픽스처와는 따로 바꿨으므로 한 테스트에 섞지 않는다. 시각(ms)은 실제 간격을 남긴 채 옮긴 값이다. 픽스처는 [`fixtures/0007/`](fixtures/0007/)에 있다.

## 요약

| #   | 항목                          | 결론                                                                                                                                                                                                                                     |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Orca 터미널에서 비대화형 실행 | `terminal create --worktree <w> --command '<명령>'`으로 된다. `agent launch`·`worktree create --agent`에는 실행마다 인자를 넘기는 플래그가 없다. 에이전트 인자는 러너 전체 설정이다                                                      |
| 2   | 끝남 관측                     | `claude -p`는 일을 마치면 끝난다. 도는 동안 `worktree ps`의 `agents[]`에 `working`으로 오르고 끝나면 빠진다. 셸에 `exit`를 붙이면 터미널도 끝나 `terminal wait --for exit`가 돌아온다                                                    |
| 3   | 종료 코드                     | Orca의 `terminal wait`가 주는 `exitCode`는 틀린다(7·1이어도 0). 감싼 명령이 워크트리 밖 파일에 쓴 종료 코드가 가장 믿을 만하다. 터미널 출력의 `__FO_EXIT__=<n>` 마커도 읽히지만 터미널이 끝나면 `tail`이 빈다                            |
| 4   | 권한                          | `-p`에서 허용하지 않은 도구는 묻지 않고 거절되고 에이전트는 계속 간다. 거절은 결과 JSON의 `permission_denials`에 남는다. 미리 허용은 `--allowedTools`, `--permission-mode`, `--settings`로 한다                                          |
| 5   | 프롬프트 전달                 | 프롬프트를 ssh stdin으로 러너의 파일에 올리고(`ssh <host> 'cat > <runDir>/prompt.md' < 파일`), `claude -p ... < <runDir>/prompt.md`로 넘긴다. 줄바꿈·따옴표·백틱·`$`·백슬래시가 그대로 갔다. `--command` 문자열에는 고정 경로만 들어간다 |

## 1. Orca 터미널에서 비대화형 명령 실행

### `terminal create --command`

```
orca terminal create --worktree path:<path>/workspaces/sandbox/fo-headless-h1 \
  --title fo-a1b --command '<명령>' --json
```

종료 코드 0으로 바로 돌아왔다 **[실행]**. 픽스처: [`terminal-create-command.json`](fixtures/0007/terminal-create-command.json). 어댑터가 쓸 필드만 옮긴다.

```json
{
  "ok": true,
  "result": {
    "terminal": {
      "handle": "term_<uuid>",
      "paneKey": "<tabId>:<leafId>",
      "worktreeId": "<repoId>::<path>/workspaces/sandbox/fo-headless-h1",
      "title": "fo-a1b",
      "surface": "background",
      "warning": "Terminal term_<uuid> is running, but Orca could not make it discoverable. ..."
    }
  }
}
```

- `--command`는 러너 사용자의 로그인 셸(zsh)에 입력되어 돈다 **[스키마]**(`terminal create --help`: "--command is typed into whatever shell the host started"). 그래서 `;`, `$(...)`, `<`, `>`, `$?` 같은 셸 문법이 그 셸에서 풀린다 **[실행]**.
- `surface: "background"`와 `warning`(터미널을 화면 탭으로 올리지 못했다)이 왔지만 명령은 돌았고 `terminal read`·`worktree ps`로 보였다 **[실행]**. 러너 화면에 창을 띄우지 않은 상태라 그런 것으로 보이나 원인은 확인하지 않았다.
- 결과의 `paneKey`가 그 터미널에서 돈 에이전트의 `worktree ps` `agents[].paneKey`와 같았다 **[실행]**(2절). research 0004의 "전에 본 에이전트가 사라짐" 판정에 이 값을 그대로 쓸 수 있다.

### `agent launch`·`worktree create --agent`에는 실행마다 넘기는 인자가 없다

- 두 명령의 플래그는 `--agent`, `--prompt`, `--model`, `--effort`, `--surface`뿐이다 **[스키마]**. 에이전트 CLI에 `-p` 같은 인자를 실행마다 덧붙이는 플래그가 없다.
- Orca 설정에는 에이전트별 인자와 실행 명령 덮어쓰기(`agentCmdOverrides`)가 있다 **[소스]**(`shared/agent-launch/choices/tui-agent-launch-defaults.js`, `startup/tui-agent-launch-command-override.js`). 러너의 모든 에이전트 띄우기에 걸리는 설정이라 사람이 그 러너에서 띄우는 에이전트도 바뀐다. Claude Code의 프롬프트 전달 방식은 `argv`(`promptInjectionMode: 'argv'`)라서 인자에 `-p`를 넣으면 비대화형으로 뜰 수도 있으나 시험하지 않았다(러너 설정을 바꾸지 않았다).
- `automations create`에는 `--extra-agent-args`가 있지만 "model, effort와 몇몇 안전한 옵션"만 받는다 **[스키마]**.
- 권한 설정도 같은 소스에 있다. 에이전트마다 `manual`, `auto`(Claude Code는 `--permission-mode auto`), `yolo`(Claude Code는 `--dangerously-skip-permissions`)가 있고, 설정을 손대지 않은 에이전트의 예전 기본값이 `yolo`다 **[소스]**(`permissions/tui-agent-permissions.js`의 `YOLO_TUI_AGENT_ARGS`, `DEFAULT_TUI_AGENT_ARGS`). research 0004에서 Orca가 Claude Code를 `--dangerously-skip-permissions`로 띄운 까닭이 이것으로 보인다.

그래서 비대화형 실행은 `terminal create --command`로 띄운다. 에이전트를 Orca의 에이전트 띄우기로 만들지 않아도 `worktree ps`가 에이전트를 본다(2절).

## 2. 끝남 관측

### 에이전트 프로세스는 끝난다

A1b(`claude -p ... < prompt.md`)는 약 10초(`duration_ms: 9873`) 만에 끝났고 감싼 명령이 `__FO_EXIT__=0`을 찍은 뒤 셸 프롬프트로 돌아왔다 **[실행]**.

3초 간격으로 `worktree ps --agent-wait --json`을 읽었다 **[실행]**.

| 폴링 | 행 `status` | `agents[]`                                                  |
| ---- | ----------- | ----------------------------------------------------------- |
| 1    | `working`   | `state: working`, `paneKey`는 `terminal create`의 값과 같음 |
| 2    | `working`   | 같음                                                        |
| 3    | `working`   | 같음, `toolName: "Bash"`(거절될 도구 호출 중)               |
| 4    | `active`    | `[]`                                                        |

픽스처: [`worktree-ps-headless-working.json`](fixtures/0007/worktree-ps-headless-working.json)(폴링 3), [`worktree-ps-headless-after-exit.json`](fixtures/0007/worktree-ps-headless-after-exit.json)(끝난 뒤).

- 비대화형 에이전트도 대화형처럼 훅으로 `agents[]`에 오른다. `agentType: "claude"`, `conversationName`은 터미널 제목(`fo-a1b`), `prompt`는 처음 200자다 **[실행]**. 이 러너는 Claude Code 사용자 설정에 훅이 있었다. 훅이 꺼진 러너는 확인하지 않았다(research 0004의 열린 질문 6과 같다).
- 첫 폴링(시작 약 3초 뒤)에 이미 에이전트가 있었다. 그보다 이른 구간은 재지 않았다.
- 끝나면 `agents`에서 빠지고 행은 `active`다. 대화형에서 `/exit`로 끝낸 경우(research 0004)와 모양이 같다. `state: done`으로 머무는 구간은 폴링에 잡히지 않았다.

### 셸이 남는 경우와 끝내는 경우

감싼 명령 끝에 `exit`가 없으면(E1, A1b) 로그인 셸이 남는다. `terminal read`의 `status`는 `running`이고 셸 프롬프트가 `tail` 끝에 보인다 **[실행]**.

끝에 `exit $c`를 붙이면(E2, A2) 셸이 끝나 터미널도 끝난다 **[실행]**.

- `orca terminal wait --terminal <handle> --for exit --timeout-ms <ms> --json`이 `satisfied: true`, `status: "exited"`로 돌아온다. 이미 끝난 터미널에 다시 불러도 바로 같은 답이 온다. 끝나기 전에 시간을 넘기면 `ok: false`, `error.code: "timeout"`, 종료 코드 1이다(E1).
- `terminal read`는 `status: "exited"`이고 `tail`이 빈다.
- `terminal list`에서 빠진다.
- `terminal show`는 계속 답한다. `connected: false`, `writable: false`, `exitCause`가 있고 `preview`에 마지막 출력의 끝부분이 남는다. 픽스처: [`terminal-show-after-exit.json`](fixtures/0007/terminal-show-after-exit.json).

`terminal wait`는 끝날 때까지 ssh 연결을 붙잡으므로 어댑터의 폴링에는 맞지 않는다. 폴링은 `worktree ps`와 3절의 종료 코드 파일로 한다.

## 3. 종료 코드

### Orca의 `exitCode`는 쓸 수 없다

`terminal wait --for exit`의 결과에 `exitCode`가 있지만 E2(셸이 `exit 7`)와 A2(셸이 `exit 1`) 모두 `exitCode: 0`이었다 **[실행]**. 함께 온 `exitCause`는 `{ "kind": "unknown", "reason": "host_status_unavailable" }`다. 픽스처: [`terminal-wait-exit.json`](fixtures/0007/terminal-wait-exit.json)(A2).

```json
{
  "ok": true,
  "result": {
    "wait": {
      "condition": "exit",
      "satisfied": true,
      "status": "exited",
      "exitCode": 0,
      "exitCause": { "kind": "unknown", "reason": "host_status_unavailable" }
    }
  }
}
```

이 러너에서는 Orca가 터미널 프로세스의 실제 종료 상태를 받지 못한다. 다른 러너나 다음 버전에서 맞는 값이 올 수 있으나, `exitCause.kind`가 `unknown`인 동안은 `exitCode`를 믿지 않는다.

### 터미널 출력의 마커

E1에서 `terminal read`의 `tail`에 다음이 나왔다 **[실행]**. 픽스처: [`terminal-read-exit-marker.json`](fixtures/0007/terminal-read-exit-marker.json).

```json
"tail": [
  "<user>@<host> fo-headless-h1 % claude --fo-bogus-flag; echo __FO_EXIT__=$?",
  "error: unknown option '--fo-bogus-flag'",
  "__FO_EXIT__=1",
  "<user>@<host> fo-headless-h1 %"
]
```

A1b는 `__FO_EXIT__=0`, A2는 `terminal show`의 `preview` 끝에 `__FO_EXIT__=1`이 남았다 **[실행]**.

- 셸이 입력된 명령을 다시 찍으므로 `__FO_EXIT__=$c` 같은 원문도 `tail`에 있다. 줄 전체가 `^__FO_EXIT__=(\d+)$`인 것만 읽는다.
- 셸을 끝내면 `tail`이 비어 `terminal show`의 `preview`에만 남는다. `preview`는 앞이 잘린 짧은 글이다.
- 긴 줄은 화면 폭에서 접혀 `tail`에 여러 줄로 올 수 있다(`tailRows[].wrapped`). E1의 `terminal read`(`source: "stream"`)에는 `tailRows`가 오지 않았다. 마커는 짧아 접히지 않을 것으로 보지만 확인하지 않았다.

마커는 사람이 터미널에서 보기 좋은 보조 수단이다. 터미널 출력에 기대므로 어댑터의 기본 경로로는 약하다.

### 워크트리 밖 파일

감싼 명령이 종료 코드를 `<runDir>`의 파일(E2는 `exit-code`, A1b는 `a1-exit`, A2는 `a2-exit`)에 쓰게 하고 ssh로 `cat`했다 **[실행]**. E2는 `7`, A1b는 `0`, A2는 `1`로 셸이 받은 값과 같았다.

- 터미널 출력, 셸 종료 여부, `terminal close`와 상관없이 남는다.
- 워크트리 밖에 두어 워크트리를 더럽히지 않는다. 워크트리 안의 untracked 파일은 `worktree rm`을 `--force` 없이 실패하게 한다([research 0003](0003-orca-runner-contract.md) 9절).
- 파일이 있으면 에이전트 프로세스가 끝났다는 뜻이기도 하다. 감싼 명령이 쓰는 도중에 읽지 않도록 임시 이름으로 쓰고 `mv`하는 것을 제안한다(시험하지 않았다).

### 에이전트 결과 JSON

`--output-format json`의 표준 출력을 `<runDir>`의 파일로 돌렸다 **[실행]**. 픽스처: [`claude-print-success.json`](fixtures/0007/claude-print-success.json)(A1b), [`claude-print-max-turns.json`](fixtures/0007/claude-print-max-turns.json)(A2).

| 필드                 | A1b(종료 코드 0)     | A2(종료 코드 1)                           |
| -------------------- | -------------------- | ----------------------------------------- |
| `subtype`            | `success`            | `error_max_turns`                         |
| `is_error`           | `false`              | `true`                                    |
| `terminal_reason`    | `completed`          | `max_turns`                               |
| `result`             | 에이전트의 마지막 답 | 없음(키가 없다)                           |
| `errors`             | 없음                 | `["Reached maximum number of turns (1)"]` |
| `permission_denials` | Bash 하나            | `[]`                                      |

`session_id`, `num_turns`, `duration_ms`, `total_cost_usd`, `usage`, `modelUsage`도 온다. 정상 종료·오류 종료는 종료 코드로 가르고(GLOSSARY), 이 JSON은 런 상세에 붙일 정보로 쓸 수 있다. 오류 종료 중에는 이 JSON이 나오지 않는 경우도 있다. A1처럼 인자 오류면 결과 파일이 비고 오류는 stderr에만 남았다 **[실행]**.

## 4. 권한

### 비대화형에서 권한이 필요한 도구

A1b 프롬프트는 Write로 파일을 만들고 Bash로 `touch`를 돌리라고 했다. `--allowedTools Write`만 줬다. 러너의 Claude Code 사용자 설정은 기본 권한 모드에 허용 규칙이 MCP 하나뿐이었다 **[실행]**.

- Write는 허용대로 실행됐다.
- Bash는 묻지 않고 거절됐다. 에이전트는 기다리지 않고 다음 단계로 가서 "DENIED"라고 답했고 종료 코드 0으로 끝났다 **[실행]**.
- 거절은 결과 JSON의 `permission_denials[]`에 `tool_name`, `tool_use_id`, `tool_input`으로 남았다 **[실행]**.
- `worktree ps`에서 `waiting`이나 `blocked`는 보지 못했다(3초 간격 폴링).

비대화형에서 권한 거절은 런을 멈추지 않는다. 에이전트가 할 일을 못 하고 정상 종료할 수 있으므로, 결과 JSON의 `permission_denials`를 런 상세에 보여 주는 편이 낫다.

### 미리 허용하는 방법

`claude --help`가 적는 것 **[스키마]**. 위험한 전체 우회(`--dangerously-skip-permissions`, `--permission-mode bypassPermissions`)는 쓰지 않았다.

- `--allowedTools <tools...>`, `--disallowedTools <tools...>`: 도구 이름이나 규칙(`"Bash(git *)"`, `Edit`)을 쉼표나 공백으로 나열한다. A1b에서 `--allowedTools Write`가 동작했다 **[실행]**.
- `--permission-mode <mode>`: `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan`.
- `--permission-prompts <target>`: `--print`에서 권한 질문을 누가 받는지. `host`(SDK 호스트나 `--permission-prompt-tool`) 또는 `none`(묻는 대신 거절).
- `--settings <file-or-json>`: 설정 파일을 더 읽는다. 런마다 `<runDir>/settings.json`에 허용 규칙을 써서 넘길 수 있다. 시험하지 않았다.
- `--max-turns`, `--max-budget-usd`: 턴 수와 비용 상한. `--max-turns 1`이 동작해 오류 종료(1)를 냈다 **[실행]**.
- 프로젝트의 `.claude/settings.json`에도 허용 규칙을 둘 수 있으나(Claude Code 설정 문서) 대상 저장소에 파일을 더하는 일이라 오케스트레이터가 쓰기에는 맞지 않는다. 시험하지 않았다.

### `--allowedTools`가 프롬프트를 삼킨다

A1은 `claude -p --model haiku --output-format json --allowedTools Write "$(cat prompt.md)"`였다. `--allowedTools`가 값을 여러 개 받아 프롬프트까지 가져갔고, 모델을 부르지 않고 종료 코드 1로 끝났다 **[실행]**. 픽스처: [`claude-print-allowedtools-ate-prompt.txt`](fixtures/0007/claude-print-allowedtools-ate-prompt.txt).

```
"Test task. Do not push and do not open …" was read as a value of --allowedTools, not as a prompt · put a prompt before --allowedTools or after --
Error: Input must be provided either through stdin or as a prompt argument when using --print
```

프롬프트를 stdin으로 넘기거나(A1b) `--` 뒤에 두면(A2) 된다 **[실행]**.

## 5. 프롬프트 전달

### 러너에 올리기

```
ssh <host> 'cat > <runDir>/prompt.md' < prompt.md
```

프롬프트가 ssh 명령 문자열이 아니라 stdin으로 가므로 셸 인용이 필요 없다. 올린 파일과 원본의 SHA-256이 같았다 **[실행]**. research 0004의 ssh 명령 문자열 한계(약 256 KiB)도 이 경로에는 걸리지 않는다. 큰 프롬프트는 재지 않았다.

### 에이전트에 넘기기

A1b의 프롬프트(4줄, 백틱, `$HOME`, 작은·큰따옴표, 백슬래시 둘, `!`, 한국어):

```
Test task. Do not push and do not open a PR. Keep it short.
1. Use the Write tool to create note.txt whose only line is exactly: a `b` $HOME 'c' "d" \\ !x
2. Use the Bash tool to run exactly: touch bash-ran.txt
3. Reply with one line per step: OK or DENIED. 한국어 줄: 끝나면 멈춰요.
```

`claude -p ... < <runDir>/prompt.md`로 넘기자 에이전트가 만든 `note.txt`가 ``a `b` $HOME 'c' "d" \\ !x``로 프롬프트와 글자 하나까지 같았다 **[실행]**. A2의 `-- "$(cat <runDir>/prompt.md)"`도 프롬프트가 갔다(에이전트가 도구를 부르다 턴 상한에 걸렸다) **[실행]**.

- stdin이 더 낫다. `$(cat ...)`는 끝의 줄바꿈을 지우고, 인자 하나가 되어 러너의 `ARG_MAX`(1 MiB, research 0004)에 걸리며, 4절의 가변 인자 플래그와 부딪힌다.
- `terminal create --command` 문자열에는 고정된 경로와 플래그만 들어간다. 티켓 본문이 ssh 명령 문자열이나 로그인 셸의 명령 줄을 거치지 않는다. 경로에 공백이 있을 수 있으므로 경로는 인용한다.

## 제안: Q82 방식의 런 구현

결정은 운영자 몫이다. 확인한 사실로 짤 수 있는 안을 적는다.

### 런 시작(`startRun`)

1. `orca worktree create --repo <repo> --name <name> --branch <branch> --no-parent --json`으로 워크트리만 만든다(`--agent` 없음).
2. 러너에 런 폴더 `<runDir>`을 워크트리 밖에 만들고 프롬프트를 ssh stdin으로 올린다. 런 폴더 위치는 러너 설정으로 받는다.
3. `orca terminal create --worktree <worktreeId 선택자> --title <runId> --command '<감싼 명령>' --json`. 결과의 `handle`과 `paneKey`를 런 레코드에 둔다.

감싼 명령(Claude Code의 예):

```sh
claude -p --model "<model>" --output-format json --allowedTools "<tools>" \
  < "<runDir>/prompt.md" > "<runDir>/result.json" 2> "<runDir>/stderr.txt"
c=$?; printf '%s' "$c" > "<runDir>/exit-code.tmp" && mv "<runDir>/exit-code.tmp" "<runDir>/exit-code"
echo "__FO_EXIT__=$c"; exit "$c"
```

A1b에서 확인한 모양(stdin, `--allowedTools`)이다. 큰따옴표는 자리를 보이려는 것이고 실제 인용은 아래 이스케이프 함수가 만든다. 이 문자열은 원격 ssh 셸과 러너 로그인 셸을 두 번 거치므로, 어댑터는 감싼 명령도 인자 배열로 만들고 이스케이프 함수 한 곳에서 두 겹 인용을 맡긴다(CODING_STANDARDS의 ssh 명령 규칙). 허용 규칙을 `--settings <runDir>/settings.json`으로 넘기려면 2단계에서 그 파일도 같은 방식으로 올린다(시험하지 않았다).

에이전트 종류마다 이 명령 틀을 설정으로 두면 Codex(`codex exec`) 같은 다른 에이전트도 같은 길로 띄울 수 있다. Codex는 확인하지 않았다.

### 진행과 끝(`pollRun`)

- 끝: `<runDir>/exit-code`가 있으면 Ended다. 종료 코드는 그 파일의 값이다. 0이면 정상 종료, 아니면 오류 종료.
- 진행: 파일이 없으면 `worktree ps`의 `agents[]`(paneKey로 찾는다)로 Running·Waiting for Input을 가른다(research 0004 3절).
- 파일이 없는데 터미널이 사라졌으면(`terminal show`가 `connected: false`이거나 행에 터미널이 없음) 셸이 감싼 명령을 마치지 못하고 죽은 것이다. 종료 코드를 모르는 경우라 GLOSSARY의 에이전트 결과 여섯 가지에 딱 맞는 값이 없다. 정할 것으로 남긴다.
- 시간 초과: research 0003의 `terminal close`로 멈춘다. 셸이 먼저 죽으면 감싼 명령이 파일을 쓰지 못하지만, `claude`만 먼저 죽고 다음 줄이 돌면 파일이 생길 수 있다(비대화형으로 시험하지 않았다). 그래서 오케스트레이터는 멈추기 전에 시간 초과를 먼저 기록하고, 그 뒤 생긴 파일은 무시한다.

### 로그 꼬리

감싼 명령이 표준 출력을 파일로 돌리므로 `terminal read`에는 에이전트 출력이 거의 없다(A1b의 `tail`은 명령 줄과 마커뿐이었다) **[실행]**. 런 화면의 로그 꼬리는 `--output-format stream-json` 출력을 `tee`로 파일과 터미널에 함께 쓰거나, `<runDir>`의 파일을 ssh로 `tail`해서 얻는 안이 있다. 시험하지 않았다.

### GLOSSARY와 맞지 않는 점

- 비대화형에서는 권한 질문이 거절로 끝나 Waiting for Input이 거의 오지 않는다. `AskUserQuestion`을 쓰려 할 때 어떻게 되는지는 확인하지 않았다.
- 위 `pollRun`의 "파일 없이 터미널이 사라짐"은 에이전트 결과 여섯 가지에 들지 않는다.

## 아직 모르는 것

1. Codex(`codex exec`) 등 다른 에이전트의 비대화형 실행, 종료 코드, 권한 거절 모양.
2. `-p`에서 에이전트가 `AskUserQuestion`을 부를 때의 동작과 `worktree ps` 행.
3. 에이전트 훅이 꺼진 러너에서 비대화형 에이전트가 `agents[]`에 오르는지.
4. stdin으로 넘긴 큰 프롬프트(30 KB 이상)의 전달.
5. `terminal wait`의 `exitCode`가 맞는 값을 주는 조건(`exitCause.kind`가 `unknown`이 아닐 때).
6. `terminal create`의 `surface: "background"` 경고가 나는 까닭과 영향.
7. Orca 러너 설정의 에이전트 인자에 `-p`를 넣었을 때 `agent launch`가 비대화형으로 뜨는지.
8. `--settings <file>`로 넘긴 허용 규칙, `--permission-prompts none`의 동작.
9. `stream-json`을 `tee`로 나눠 로그 꼬리를 얻는 방법.
10. Linux 러너.

## 픽스처

[`fixtures/0007/`](fixtures/0007/)의 파일은 실제 출력에서 값만 바꿨다. `worktree-ps-*`는 `worktree ps --agent-wait --json` 결과에서 테스트 워크트리 행만 남기고 `totalCount`를 다시 셌다. `terminal-wait-exit.json`과 `terminal-show-after-exit.json`은 실행 중 화면에 찍은 출력을 옮겨 적은 것이다.

| 파일                                       | 상황                                                  |
| ------------------------------------------ | ----------------------------------------------------- |
| `terminal-create-command.json`             | `terminal create --command --json` 전체               |
| `terminal-read-exit-marker.json`           | 남은 셸에서 읽은 마커 `__FO_EXIT__=1`(E1)             |
| `terminal-wait-exit.json`                  | 셸이 1로 끝났는데 `exitCode: 0`(A2)                   |
| `terminal-show-after-exit.json`            | 끝난 터미널의 `show`, `preview`에 `__FO_EXIT__=7`(E2) |
| `worktree-ps-headless-working.json`        | 비대화형 에이전트가 도는 중(A1b)                      |
| `worktree-ps-headless-after-exit.json`     | 비대화형 에이전트가 끝난 뒤, 셸은 남음(A1b)           |
| `claude-print-success.json`                | `claude -p --output-format json` 정상 종료(A1b)       |
| `claude-print-max-turns.json`              | 같은 출력, 턴 상한 오류 종료(A2)                      |
| `claude-print-allowedtools-ate-prompt.txt` | `--allowedTools`가 프롬프트를 삼킨 stderr(A1)         |
