# Orca 러너 계약 검증: 상태 확인과 정리

조사일 2026-11-17. 티켓 0009. 스펙 10절 1, 6, 7, 9, 19번을 실제 러너에서 확인한다. Runner 어댑터의 상태 확인, 에이전트 멈추기, 워크트리 정리가 기댈 사실이다.

출처 표시는 research 0002를 따른다.

- **[실행]** 테스트 러너에서 직접 돌린 명령의 결과. macOS(arm64) 러너, Orca 1.4.258, 오케스트레이터 기계에서 비대화형 `ssh <host> '<command>'`로 실행했다.
- **[스키마]** `orca <command> --help`와 `orca agent-context --json`.

테스트 저장소는 버려도 되는 비공개 저장소 하나를 러너에 clone해 Orca 프로젝트로 등록했고, 워크트리 넷(W1~W4)에 Claude Code를 하나씩 짧게 띄웠다. 이 문서에 쓴 것은 W1(에이전트가 끝난 뒤 `rm`), W2(입력 기다리는 에이전트에 `terminal close`), W4(에이전트가 도는 중에 `rm`)다. W3(0이 아닌 종료 코드)는 research 0004에 쓴다. 런은 0010 검증과 같은 세션에서 돌려 에이전트를 띄운 횟수를 줄였다. 확인이 끝난 뒤 워크트리와 브랜치를 모두 지웠다.

예시와 픽스처의 로컬 경로, 호스트명, 사용자명, 계정은 `<path>`, `<host>`, `<user>`, `acme`로 바꿨다. UUID와 시각은 순서만 남긴 가상 값이다. 픽스처는 [`fixtures/0003/`](fixtures/0003/)에 있다.

## 요약

| #   | 항목                         | 결론                                                                                                                                         |
| --- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 런타임이 꺼졌을 때           | `status --json`은 `ok: true`·종료 코드 0에 `runtime.reachable: false`. 런타임이 필요한 명령은 `runtime_unavailable`·종료 코드 1              |
| 6   | ssh 비대화형 셸              | `orca`가 PATH에 없다(종료 코드 127). 절대 경로로 부르면 런타임에 닿는다. 특별한 환경 변수나 GUI 세션은 필요 없다                             |
| 7   | Linux 러너                   | **남음.** Linux 러너가 아직 없다. help가 적은 것만 옮겼다                                                                                    |
| 9   | `worktree rm`                | 이번 러너에서는 에이전트가 남긴 untracked 파일 때문에 `--force` 없이는 `runtime_error`로 실패했다. `--force`는 도는 에이전트를 멈추고 지운다 |
| 19  | 시간 초과 때 에이전트 멈추기 | `orca terminal close`로 멈춘다. 워크트리는 남는다. `worktree rm --force`로 갈음하지 않는다                                                   |

이 밖에 러너의 GitHub 인증이 비대화형 ssh 세션에서 동작하지 않는 경우를 만났다(아래 "러너의 GitHub 인증").

## 1. 런타임이 꺼졌을 때

`orca serve service uninstall`로 상시 서비스를 내리고 관찰한 뒤, 같은 플래그로 다시 설치했다 **[실행]**.

### `orca status --json`

`ok: true`, 종료 코드 0이다. 꺼졌다는 사실은 `result` 안에 있다 **[실행]**. 픽스처: [`status-runtime-off.json`](fixtures/0003/status-runtime-off.json).

```json
{
  "id": "local-status",
  "ok": true,
  "result": {
    "target": { "kind": "local" },
    "app": { "running": false, "pid": null },
    "runtime": { "state": "not_running", "reachable": false, "runtimeId": null },
    "graph": { "state": "not_running" }
  },
  "_meta": { "runtimeId": "none" }
}
```

켜져 있을 때와 달리 `runtime.connectionState`, `appVersion`, `capabilities`가 없고, `_meta.runtimeId`는 문자열 `"none"`이다. 스키마는 이 필드들을 선택으로 둬야 한다.

`--json` 없이 부른 `orca status`는 같은 상황에서 종료 코드 **1**을 낸다(`runtimeState: not_running` 등 키-값 줄) **[실행]**. `--json`일 때와 종료 코드가 다르므로 어댑터는 `--json`을 주고 종료 코드가 아니라 JSON으로 판단한다.

### 런타임이 필요한 명령

`worktree ps`, `worktree list`, `worktree rm`, `project list`, `terminal list`가 모두 같은 오류를 냈다 **[실행]**. 종료 코드 1, stderr는 비어 있다. 픽스처: [`worktree-ps-runtime-off.json`](fixtures/0003/worktree-ps-runtime-off.json), [`worktree-rm-runtime-off.json`](fixtures/0003/worktree-rm-runtime-off.json).

```json
{
  "id": "local",
  "ok": false,
  "error": {
    "code": "runtime_unavailable",
    "message": "Could not read Orca runtime metadata at <path>/orca/orca-runtime.json. Start the Orca app first."
  },
  "_meta": { "runtimeId": null }
}
```

`error.data`(`nextSteps` 등)는 없다. `--json` 없이 부르면 stderr에 같은 메시지와 `Orca is not running. Run 'orca open' first.`가 나오고 종료 코드 1이다 **[실행]**. `orca --version`은 런타임 없이 `1.4.258`을 내고 종료 코드 0이다 **[실행]**.

### 서비스 상태

서비스를 지운 뒤 `orca serve service status --json`은 `ok: true`, 종료 코드 0에 `installed: false`, `verdict: "exited"`, `pid: null`, `detail: "not loaded"`를 냈다 **[실행]**. 픽스처: [`serve-service-status-uninstalled.json`](fixtures/0003/serve-service-status-uninstalled.json). 켜져 있을 때는 `installed: true`, `verdict: "live"`, `detail: "running"`이다.

같은 플래그(`--bind 127.0.0.1 --refuse-public --command <orca 절대 경로>`)로 다시 설치하자 15초 안에 `verdict: "live"`, `runtime.state: "ready"`로 돌아왔다 **[실행]**. 다시 띄운 런타임은 `runtimeId`가 바뀌었다 **[실행]**. 터미널 핸들은 그것을 낸 서버에 속한다고 help가 적는다 **[스키마]**(`--environment` 설명). 런타임이 다시 뜬 뒤 예전 핸들이 계속 쓰이는지는 확인하지 않았다.

### 어댑터에 주는 뜻

- Online 판정은 research 0002 A.3대로 "ssh 성공 + `ok: true` + `runtime.reachable: true` + `runtime.state: "ready"`"로 잡는다. 런타임이 꺼진 러너도 `status --json`은 성공하므로 `ok`만 보면 안 된다.
- 다른 명령의 `runtime_unavailable`은 "러너에 닿았지만 런타임이 없다"는 뜻이다. ssh 실패(러너에 닿지 않음)와 나눠 다룬다.

## 6. ssh 비대화형 셸에서 `orca`

- 비대화형 ssh 셸(러너 사용자의 로그인 셸은 zsh)의 PATH는 `/usr/bin:/bin:/usr/sbin:/sbin`이었다. `orca status --json`은 `zsh:1: command not found: orca`, 종료 코드 127이다 **[실행]**.
- 절대 경로 `/Applications/Orca.app/Contents/Resources/bin/orca`로 부르면 `runtime.reachable: true`, `state: "ready"`이고 워크트리 만들기부터 지우기까지 모든 명령이 됐다 **[실행]**.
- ssh 세션의 환경 변수는 `HOME`, `LANG`, `LOGNAME`, `PATH`, `PWD`, `SHELL`, `SHLVL`, `SSH_CLIENT`, `SSH_CONNECTION`, `TMPDIR`, `USER`뿐이었다 **[실행]**. Orca 전용 환경 변수나 GUI 로그인 세션 없이 런타임에 닿는다. 런타임은 상시 서비스(아래)로 떠 있었다.
- 원격 셸이 zsh면 변수 하나에 담은 명령 문자열이 낱말로 쪼개지지 않는다. `"$c"`에 `status --json`을 넣어 부르자 `Unknown command: status --json`이 났다 **[실행]**. 어댑터는 인자마다 따로 셸 인용을 해서 이어 붙인 명령 문자열을 보낸다.

러너 설정에는 `orca` 실행 파일 경로를 두고, 기본값은 macOS 앱 경로로 한다. 0002 A.8의 판단과 같다.

### 상시 서비스 구성(macOS)

코디네이터가 `orca serve service install --bind 127.0.0.1 --refuse-public --command <orca 절대 경로>`로 설치했다. 설치된 LaunchAgent는 다음과 같다 **[실행]**.

- 위치 `<path>/LaunchAgents/com.stablyai.orca.serve.plist`, 이름 `com.stablyai.orca.serve`.
- `ProgramArguments`: `<orca> serve --supervise --no-pairing --bind 127.0.0.1 --refuse-public`.
- `EnvironmentVariables`: `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, `ORCA_USER_DATA_PATH`.
- `RunAtLoad: true`, `KeepAlive.SuccessfulExit: false`, `ThrottleInterval: 10`, 로그는 `<path>/Logs/Orca/com.stablyai.orca.serve.log`.

1.4.258의 `serve service install`에는 `--supervise` 플래그가 없다. usage는 `[--port] [--bind] [--pairing-address] [--allow-public | --refuse-public] [--command <path>] [--dry-run] [--json]`이고, 서비스가 늘 `orca serve --supervise --no-pairing`을 돌린다 **[스키마]**. PATH에 `orca`가 없으면 `cli_not_found`로 실패해 `--command <절대 경로>`가 필요했다 **[실행]**(코디네이터가 설치 때 관찰).

서비스의 PATH는 좁지만 에이전트는 러너 사용자의 로그인 셸 터미널 안에서 뜬다. 에이전트가 끝난 뒤 그 터미널에 zsh 프롬프트가 남았고, `~/.local/bin`에 있는 `claude`를 찾아 실행했다 **[실행]**. 에이전트 실행 파일은 사용자 셸 설정의 PATH로 찾는다.

## 7. Linux 러너: 남음

운영자가 Linux 테스트 러너를 아직 준비하지 않아 실행하지 못했다. help가 적는 것만 옮긴다 **[스키마]**(`orca serve service install --help`).

- Linux에서는 systemd user unit을 쓴다. 서비스는 macOS와 같이 `orca serve --supervise --no-pairing`을 돌린다.
- `--command`의 기본값은 PATH의 `orca-ide`다(macOS는 `orca`). Linux에서는 CLI 이름부터 다를 수 있다.
- 로그아웃하면 서비스가 멈춘다. `loginctl enable-linger`를 켜야 하고, install이 이를 알린다.

확인할 것: 설치 경로와 CLI 이름(`orca-ide`인지), 비대화형 ssh PATH, systemd unit 내용, linger 없이 ssh로만 쓰는 러너에서 서비스가 사는지.

## 9. `worktree rm`

### `--force` 없이: 에이전트가 돈 워크트리는 지워지지 않는다

에이전트가 끝난 워크트리(W1)와 에이전트가 `sleep 120`을 돌리던 워크트리(W4) 모두에서 실패했다 **[실행]**. 종료 코드 1. 픽스처: [`worktree-rm-dirty-error.json`](fixtures/0003/worktree-rm-dirty-error.json), [`worktree-rm-while-working-error.json`](fixtures/0003/worktree-rm-while-working-error.json).

```json
{
  "id": "<uuid>",
  "ok": false,
  "error": {
    "code": "runtime_error",
    "message": "Failed to delete worktree at <path>/workspaces/sandbox/fo-verify-w1. ?? <agent-plugin-state>\n?? note.txt"
  },
  "_meta": { "runtimeId": "<uuid>" }
}
```

- 원인은 untracked 파일이다. 메시지에 `git status --short` 줄이 붙는다. 에이전트가 만든 파일(`note.txt`)뿐 아니라 러너의 에이전트 플러그인이 세션마다 쓰는 상태 파일도 걸렸다(픽스처에서는 `<agent-plugin-state>` 한 줄로 줄였다). W4는 플러그인 상태 파일만으로 실패했다. 플러그인이 없고 에이전트가 변경을 모두 커밋하는 러너라면 `--force` 없이 지워질 수 있지만, 러너 구성에 기대지 않으려면 `--force`를 늘 준다.
- `error.code`가 일반적인 `runtime_error`라 "더러워서 못 지움"을 코드로 가를 수 없다.
- 실패한 `rm`은 아무것도 멈추지 않았다. 터미널은 `connected: true`로 남고, 에이전트 셸과 `sleep`도 살아 있었다 **[실행]**.

### `--force`: 도는 에이전트를 멈추고 지운다

```json
{
  "id": "<uuid>",
  "ok": true,
  "result": { "removed": true, "catalogVersion": { "epoch": "<uuid>", "sequence": 16 } },
  "_meta": { "runtimeId": "<uuid>" }
}
```

종료 코드 0 **[실행]**. 픽스처: [`worktree-rm-force.json`](fixtures/0003/worktree-rm-force.json)(W1, 에이전트가 끝나 셸만 남은 상태, `--delete-branch` 없이), [`worktree-rm-force-delete-branch.json`](fixtures/0003/worktree-rm-force-delete-branch.json). 지우기 직전 W4 행은 [`worktree-ps-before-rm-working.json`](fixtures/0003/worktree-ps-before-rm-working.json)이다(`status: "working"`, `agents[0].state: "working"`, `programStatus.message: "1 shell still running"`).

에이전트가 `sleep 120`을 돌리는 중에 `rm --force --delete-branch`를 부르자 다음이 일어났다 **[실행]**.

- 에이전트 터미널이 끝났다. `terminal read`는 `status: "exited"`, 빈 `tail`을 낸다.
- 에이전트 프로세스와 그 자식(`sleep`)이 사라졌다. 워크트리를 작업 디렉터리로 쓰는 프로세스는 에이전트 플러그인의 세션 종료 훅 워커만 잠깐 남았다가 끝났다.
- 디렉터리가 지워지고, 행이 `worktree ps`에서 사라지고, `worktree show`는 `selector_not_found`를 냈다.

결과에는 브랜치 정보가 없다. 브랜치는 다음과 같았다 **[실행]**.

- `--delete-branch` 없이(W1): 브랜치가 남아 손으로 지웠다. help대로다 **[스키마]**.
- `--delete-branch`(W2, W3, W4): 기준 브랜치에서 커밋이 늘지 않은 브랜치는 모두 지워졌다. 병합되지 않은 커밋이 있는 브랜치는 시험하지 않았다. help는 병합이 증명되지 않은 브랜치는 남긴다고 적는다 **[스키마]**.

### 어댑터에 주는 뜻

- `removeWorktree`는 `worktree rm --worktree id:<repoId>::<path> --force --json`으로 한다. `--force` 없이는 거의 늘 실패한다.
- 지운 뒤 `worktree show`의 `selector_not_found`로 확인할 수 있다. 결과의 `removed: true`만으로도 충분했다.
- 브랜치는 PR이 쓰므로 `--delete-branch`는 주지 않는다. 결과로 브랜치가 지워졌는지 알 수 없다.

## 19. 시간 초과 때 에이전트 멈추기

### `orca terminal close`

```
orca terminal close ([--terminal <handle>] [--tab] | --worktree <selector> --all) [--json]
```

**[스키마]** `--terminal`은 터미널 하나, `--tab`은 그 탭 전체, `--worktree <selector> --all`은 워크트리의 모든 터미널 프로세스를 멈추고 탭·레이아웃·재개 기록까지 지운다.

`AskUserQuestion`에서 답을 기다리던 에이전트(W2)에 `terminal close --terminal <handle> --json`을 불렀다 **[실행]**. 종료 코드 0. 픽스처: [`terminal-close.json`](fixtures/0003/terminal-close.json).

```json
{
  "id": "<uuid>",
  "ok": true,
  "result": { "close": { "handle": "term_<uuid>", "tabId": "<uuid>", "ptyKilled": true } },
  "_meta": { "runtimeId": "<uuid>" }
}
```

- 에이전트 프로세스가 사라졌다. 에이전트의 세션 종료 훅이 돌았으므로 강제 종료(SIGKILL)보다는 터미널이 끊긴 종료(hangup)로 보인다.
- 같은 핸들의 `terminal read`는 `status: "exited"`, 빈 `tail`이다([`terminal-read-after-close.json`](fixtures/0003/terminal-read-after-close.json)). `terminal list --worktree`는 0개다.
- 워크트리는 남는다. 행은 `status: "inactive"`, `liveTerminalCount: 0`, `hasAttachedPty: false`, `terminalVerdict: "none"`, `agents: []`가 된다([`worktree-ps-after-terminal-close.json`](fixtures/0003/worktree-ps-after-terminal-close.json)).

### 비교

| 명령                                    | 에이전트 멈춤                  | 워크트리 | 실행 여부      |
| --------------------------------------- | ------------------------------ | -------- | -------------- |
| `terminal close --terminal <handle>`    | 멈춤                           | 남음     | **[실행]**     |
| `terminal close --worktree <sel> --all` | help상 워크트리의 모든 터미널  | 남음     | **[스키마]**만 |
| `worktree rm --force`                   | 멈춤                           | 지워짐   | **[실행]**     |
| `terminal send --interrupt`             | 에이전트마다 다름(Ctrl+C 처리) | 남음     | 시험하지 않음  |

### 결론: 에이전트 멈추기는 `terminal close`로 한다

Runner 어댑터의 "에이전트 멈추기"는 `orca terminal close --worktree id:<repoId>::<path> --all --json`으로 한다.

- 워크트리 선택자만으로 부를 수 있어, 런 레코드에 터미널 핸들이 없거나 런타임이 다시 떠 핸들이 바뀐 경우에도 쓸 수 있다. 에이전트가 띄운 다른 터미널도 함께 멈춘다.
- `--all` 형태는 실행하지 않았다. 같은 명령의 `--terminal <handle>` 형태로 멈춤을 확인했다. 0013에서 `--all` 출력을 확인하고, 필요하면 `worktree create` 결과의 `launch.outcome.handle`로 `--terminal` 형태를 쓴다.
- `worktree rm --force`로 갈음하지 않는다. 시간 초과 런도 PR 상태를 판정하고 사람이 볼 수 있어야 하며, 워크트리 정리는 런이 끝나고 PR 상태를 판정한 뒤의 일이다(0002 A.7).

## 러너의 GitHub 인증

테스트 저장소를 러너에서 clone하려다 러너의 GitHub 인증이 비대화형 ssh 세션에서 하나도 동작하지 않았다 **[실행]**.

- `gh`(`/opt/homebrew/bin/gh`, 비대화형 PATH 밖): `The token in default is invalid`, API는 HTTP 401.
- https clone: 자격 증명 도우미가 키체인을 읽지 못했다(`failed to get: -25308`). 비대화형 세션에서 키체인이 잠겨 있던 것으로 보인다.
- ssh clone: 러너에 GitHub용 ssh 키가 없어 거부됐다.

이번 검증은 오케스트레이터 기계에서 git bundle을 만들어 러너로 옮겨 clone했고, 에이전트에게는 push·PR을 시키지 않았다. 실제 런에서는 에이전트가 러너의 비대화형 세션에서 push하고 PR을 연다. 그래서:

- 러너의 필수 조건에 "에이전트가 비대화형 세션에서 push·PR을 할 수 있는 GitHub 인증"이 들어가야 한다.
- 온보딩 러너 확인 단계에서 이를 점검해야 한다. 예: ssh로 `git ls-remote <저장소>`와 `gh auth status`(gh를 쓰는 에이전트라면)를 부른다. 점검 방법은 아직 정하지 않았다(아래 "아직 모르는 것").

## 아직 모르는 것

1. Linux 러너의 `orca` 설치 경로, CLI 이름, 서비스 구성(7번). Linux 테스트 러너가 준비되면 확인한다.
2. `terminal close --worktree <sel> --all`의 실제 출력. 0013에서 확인한다.
3. 런타임이 다시 뜬 뒤 예전 터미널 핸들로 부른 명령의 동작(`terminal_handle_stale`인지).
4. 병합되지 않은 커밋이 있는 브랜치에 `worktree rm --delete-branch`를 줄 때의 동작.
5. 러너의 GitHub 인증을 온보딩에서 무엇으로 점검할지. 에이전트마다 쓰는 인증(`gh`, git 자격 증명 도우미, ssh 키)이 달라 명령 하나로 덮기 어렵다.

## 픽스처

[`fixtures/0003/`](fixtures/0003/)의 파일은 실제 출력에서 값만 바꿨다. `worktree-ps-*` 파일은 `worktree ps --agent-wait --json` 결과에서 테스트 워크트리 행만 남기고 봉투를 다시 만들었다(`totalCount`는 남긴 행 수).

| 파일                                    | 명령·상황                                               |
| --------------------------------------- | ------------------------------------------------------- |
| `status-runtime-off.json`               | 런타임이 꺼졌을 때 `status --json`                      |
| `worktree-ps-runtime-off.json`          | 런타임이 꺼졌을 때 `worktree ps --json`                 |
| `worktree-rm-runtime-off.json`          | 런타임이 꺼졌을 때 `worktree rm --json`                 |
| `serve-service-status-uninstalled.json` | 서비스를 지운 뒤 `serve service status --json`          |
| `worktree-rm-dirty-error.json`          | 에이전트가 끝난 워크트리에 `rm`(`--force` 없이)         |
| `worktree-rm-while-working-error.json`  | 에이전트가 도는 워크트리에 `rm`(`--force` 없이)         |
| `worktree-rm-force.json`                | 에이전트가 끝난 워크트리에 `rm --force`                 |
| `worktree-rm-force-delete-branch.json`  | 에이전트가 도는 워크트리에 `rm --force --delete-branch` |
| `worktree-ps-before-rm-working.json`    | 그 직전 `worktree ps` 행                                |
| `terminal-close.json`                   | 입력 기다리는 에이전트에 `terminal close`               |
| `terminal-read-after-close.json`        | 닫은 뒤 같은 핸들의 `terminal read`                     |
| `worktree-ps-after-terminal-close.json` | 닫은 뒤 `worktree ps` 행                                |
