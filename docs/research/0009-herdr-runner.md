# herdr를 두 번째 러너 종류로 검토

조사일 2026-11-18. 티켓 없음. 운영자가 Orca 다음의 두 번째 러너 종류로 herdr(<https://herdr.dev/>)를 검토하려 한다([ADR 0008](../adr/0008-pluggable-tracker-runner-codehost.md)). 이 문서는 herdr가 무엇이고 우리 Runner 계약을 얼마나 채우는지 사실로 정리한다. 1단계 범위가 아니어서 구현하지 않는다. 결정은 운영자 몫으로 남긴다.

비교 기준은 main의 `packages/core/src/adapters.ts` `Runner` 인터페이스와 [research 0008](0008-orca-orchestration-run.md)의 「제안: Runner 어댑터 계약」이다. 인터페이스는 0037에서 갱신 중이라 둘을 함께 본다.

출처 표시는 research 0004를 따른다.

- **[문서]** 공식 사이트와 공식 저장소. 링크를 문장 옆에 단다. 2026-11-18에 읽었다.
- **[실행]** 오케스트레이터 기계(macOS arm64)에서 직접 돌린 결과. herdr-core `hc` 0.1.21, herdr TUI 0.9.5, Claude Code 2.1.326(Haiku 모델). **러너에는 설치하지 않았고 ssh로도 돌리지 않았다.** 명령은 TTY 없는 비대화형 셸에서 불렀다. 그래서 "ssh로 된다"는 문서 근거이고, 같은 명령이 비대화형 셸에서 JSON을 낸다는 것까지만 실행으로 확인했다.

예시의 로컬 경로와 기기 이름은 `<scratch>`, `<host>`로 바꿨다.

### 낱말

herdr의 낱말은 이 저장소의 낱말과 겹친다. 이 문서에서는 다음처럼 가른다.

| 이 문서의 표기     | 뜻                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| 런, Run            | GLOSSARY의 Run                                                                                  |
| herdr 워크스페이스 | herdr TUI의 `workspace`. 탭과 pane을 묶는 화면 단위다. GLOSSARY의 Workspace와 상관없다          |
| 워크트리           | GLOSSARY의 Worktree. herdr TUI의 `worktree`는 git 워크트리를 herdr 워크스페이스로 연 것이다     |
| 터미널             | hc의 terminal(`t7` 같은 주소, `--name`으로 붙인 이름). herdr TUI에서는 pane                     |
| 상태 보고          | 프로그램이 OSC 7501(Program Status Protocol)로 알리는 `idle`·`working`·`done`·`blocked`·`error` |
| 에이전트           | GLOSSARY의 Agent. 터미널 안에서 도는 코딩 에이전트                                              |

## 요약

| #   | 항목                    | 결론                                                                                                                                                                                                                                                                                           |
| --- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 무엇인가                | 이름이 같은 세 프로그램이다. 오래된 터미널 앱 **herdr TUI**(`herdr`, v0.9.5), 2026-10에 새로 나온 헤드리스 런타임 **herdr-core**(`hc`, 0.1.21, API는 preview), 그 위의 데스크톱 앱 **Herdr app**. 모두 Apache-2.0. TUI와 core는 에이전트를 공유하지 않는다                                     |
| 2   | 원격 제어               | 둘 다 CLI가 파이프에서 JSON을 내고, 오류는 stderr의 JSON과 0이 아닌 종료 코드다 **[실행]**. hc는 `ssh <host> hc connect`로 JSON-RPC를 그대로 실을 수 있다 **[문서]**                                                                                                                           |
| 3   | 진행 관측               | hc는 화면을 읽지 않고 프로그램의 상태 보고만 쓴다. Claude Code 2.1.326은 스스로 상태를 보고했다(`blocked`의 `kind: "permission"`·`"question"`과 질문 본문, `done`, `idle`) **[실행]**. herdr TUI는 화면을 규칙으로 읽고, 모르는 화면은 `idle`로 떨어진다 **[실행]**                            |
| 4   | 질문과 답               | 오케스트레이션 메일함이 없다. 질문은 터미널 상태(`blocked`, `kind: "question"`, `msg`)로만 보이고, 답은 키 입력(`hc keys`)이나 붙여 넣기(`hc send`)다. 질문 id와 처리됨 표시는 없다 **[실행]**                                                                                                 |
| 5   | 완료 보고               | 구조화된 완료 보고와 outcome이 없다. `done`은 "턴이 끝났다"는 뜻이다. 에이전트가 `hc send <우편함> '<보고>'`로 글을 보내게 하는 약속을 만들어야 한다. 그렇게 하면 우편함 터미널 화면에 글이 찍힌다 **[실행]**                                                                                  |
| 6   | 권한 대기               | `blocked`의 `kind: "permission"`과 무엇을 허용할지가 보인다. `hc send`는 `blocked`인 터미널에 입력을 거절한다(종료 코드 9). 하지만 `hc keys`로는 거절(`esc`)뿐 아니라 허용도 칠 수 있다 **[실행]**. Orca와 달리 허용을 막는 것은 오케스트레이터 정책이다                                       |
| 7   | 워크트리·이름·멱등      | hc에는 워크트리 명령이 없다. herdr TUI는 `worktree create --branch`로 정한 브랜치 이름 그대로 만들고, 같은 브랜치로 다시 부르면 실패하지만 `worktree open --branch`로 찾는다 **[실행]**. 이름은 둘 다 살아 있는 것끼리만 유일하다. 시작 재시도 토큰은 없다                                     |
| 8   | 멈추기·정리·로그·서비스 | `hc kill` → `state: "finished"`, `reason: "killed"` **[실행]**. 에이전트가 스스로 끝나도 `finished`에 `exit_code`·`signal`·`reason`이 남는다 **[문서]**. `hc read --lines N`이 로그 꼬리다. core는 CLI가 처음 부를 때 스스로 뜬다 **[실행]**. 재부팅에는 프로그램이 살아남지 않는다 **[문서]** |

## 1. herdr가 무엇인가

### 세 프로그램

| 프로그램   | 실행 파일 | 저장소                                                        | 무엇                                                                                                                                                                  |
| ---------- | --------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| herdr TUI  | `herdr`   | [herdrdev/herdr](https://github.com/herdrdev/herdr)           | 터미널 멀티플렉서형 앱. 백그라운드 서버가 pane을 들고 있고, 클라이언트가 붙었다 떨어진다. herdr 워크스페이스·탭·pane, git 워크트리, 에이전트 상태 감지, ssh 기기 묶기 |
| herdr-core | `hc`      | [herdrdev/herdr-core](https://github.com/herdrdev/herdr-core) | "terminals for coding agents". 화면을 그리지 않는 런타임. 끝나지 않는 터미널에서 프로그램과 에이전트를 돌리고, 에이전트가 다른 에이전트를 띄우고 보고를 받게 한다     |
| Herdr app  | GUI       | [herdrdev/herdr-app](https://github.com/herdrdev/herdr-app)   | herdr-core 위의 데스크톱·모바일 앱                                                                                                                                    |

- 지금 <https://herdr.dev/>의 첫 화면은 Herdr app이고, TUI 문서는 <https://herdr.dev/tui/>로 옮겨 갔다 **[문서]**.
- "Herdr TUI is the original Herdr ... This is a new, separate program built on herdr-core. They don't share agents" ([herdr.dev FAQ](https://herdr.dev/)) **[문서]**. hc 매뉴얼도 "It is not `herdr`, the older terminal multiplexer"라고 적는다([SKILL.md](https://github.com/herdrdev/herdr-core/blob/master/crates/herdr-core/src/SKILL.md)) **[문서]**.
- 러너로 쓸 후보는 화면 없는 **hc**와, 워크트리 명령을 가진 **herdr TUI 서버**(`herdr server`, 헤드리스) 둘이다. Herdr app은 GUI라 러너 쪽 후보가 아니다. 이 문서는 hc를 주로 보고 herdr TUI를 함께 적는다.

### 라이선스와 성숙도

GitHub API로 2026-11-18에 읽었다 **[문서]**.

| 저장소              | 라이선스   | 만든 날    | 마지막 push | 별     | 열린 이슈 | 버전                                                                                                                         |
| ------------------- | ---------- | ---------- | ----------- | ------ | --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| herdrdev/herdr      | Apache-2.0 | 2026-03-27 | 2026-11-07  | 51,541 | 513       | v0.9.5(2026-10-14 GitHub 릴리스). 문서 버전 선택에 0.5.11부터 0.9.5까지 있다                                                 |
| herdrdev/herdr-core | Apache-2.0 | 2026-10-16 | 2026-11-16  | 769    | 194       | 0.1.21([releases.herdr.dev/core/latest.json](https://releases.herdr.dev/core/latest.json)). GitHub 릴리스는 없고 태그만 있다 |
| herdrdev/herdr-app  | Apache-2.0 | 2026-10-16 | 2026-11-16  | 3,087  | 684       | -                                                                                                                            |

- hc API는 "Status: preview (protocol generation 1, version 0.x)"이다. API는 늘리기만 하고, 깨지는 변경은 새 protocol generation으로 낸다고 적었다([schema/README.md](https://github.com/herdrdev/herdr-core/blob/master/schema/README.md)) **[문서]**.
- hc는 만든 지 한 달 남짓이고, 조사 중에도 0.1.x가 자주 나왔다(태그 0.1.17~0.1.21). 사이트 바닥글의 운영 주체는 "Herdr, Inc."다 **[문서]**.

### 설치

| 대상      | macOS·Linux                                                                                            | 그 밖                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| hc        | `curl -fsSL https://releases.herdr.dev/core/install.sh \| sh` → `~/.local/bin/herdr-core`, 없으면 `hc` | 매니페스트에 플랫폼별 tar.gz URL과 SHA-256이 있다. Linux 빌드는 static. `hc update`로 갱신([README](https://github.com/herdrdev/herdr-core)) |
| herdr TUI | `curl -fsSL https://herdr.dev/install.sh \| sh`, Homebrew `brew install herdr`, mise, Nix flake        | GitHub 릴리스에 단일 바이너리. `herdr update`, stable·preview 채널([install](https://herdr.dev/tui/docs/install/))                           |

둘 다 macOS(arm64, x86_64), Linux(x86_64, aarch64), Windows(x86_64)를 지원한다 **[문서]**. 내려받은 hc tar.gz의 SHA-256이 매니페스트 값과 같았다 **[실행]**.

## 2. 원격 제어

### hc

- 파이프로 받으면 기본이 JSON이다(`run`, `exec`, `read`, `file read`는 텍스트). `--json`으로 강제할 수 있다([commands.md](https://github.com/herdrdev/herdr-core/blob/master/docs/commands.md)) **[문서]**.
- 오류는 stderr의 `{"error":{"kind","message","hint"}}`이고, 종료 코드는 3 `not_found`, 7 `needs_target`, 9 `blocked`, 10 `status_mismatch`, 11 `finished` 등이다(SKILL.md) **[문서]**. 실행에서 본 값은 다음과 같다 **[실행]**.

  | 상황                            | 종료 코드 | `error.kind` |
  | ------------------------------- | --------- | ------------ |
  | 없는 터미널 `hc get t9`         | 3         | `not_found`  |
  | 살아 있는 이름으로 `run --name` | 1         | `name_taken` |
  | `blocked`인 에이전트에 `send`   | 9         | `blocked`    |
  | 살아 있는 터미널에 `rm`         | 1         | `live`       |
  | 소켓 경로가 너무 김             | 2         | `usage`      |

  ```json
  {
    "error": {
      "hint": "typing would answer its dialog; read its screen first (hc read t2), or --force",
      "kind": "blocked",
      "message": "t2 is blocked (permission)"
    }
  }
  ```

- `hc connect`는 API를 stdin/stdout으로 싣는다. `ssh box hc connect`가 원격 core다. 프로토콜은 줄 단위 JSON-RPC 2.0이고, 오류는 `{"code":-32000,"message":...,"data":{"kind","hint"}}`다. `hc schema`가 OpenRPC 문서를 준다(schema/README.md) **[문서]**. 오케스트레이터는 지금처럼 `ssh <host> 'hc ... --json'`을 부르거나, ssh 하나로 `hc connect`를 붙잡고 `hc events`처럼 이벤트를 받을 수 있다.
- core는 CLI가 처음 부를 때 백그라운드로 뜬다(security.md "The CLI starts a background core when it needs one") **[문서]**. 첫 `hc server status --json`이 `uptime_ms: 11`이었다 **[실행]**.
- `hc machine add`와 `hc run --on <machine>`으로 오케스트레이터 기계의 core가 ssh로 러너의 core를 묶을 수도 있다([machines.md](https://github.com/herdrdev/herdr-core/blob/master/docs/machines.md)) **[문서]**. 오케스트레이터 기계에 hc를 깔아야 하므로 이 문서는 ssh로 러너의 hc를 직접 부르는 쪽을 기준으로 둔다.

### herdr TUI

- CLI가 로컬 소켓 API를 감싸고, 대부분의 명령이 `{"id":...,"result":{...}}` JSON을 낸다. 오류는 `{"error":{"code","message"},"id"}`를 stderr에 내고 종료 코드 1, CLI 사용법 오류는 2다([agent-automation](https://herdr.dev/tui/docs/agent-automation/), [cli-reference](https://herdr.dev/tui/docs/cli-reference/)) **[문서]**. 실행에서 `agent_not_found`, `timeout`, `worktree_create_failed`를 종료 코드 1로 봤다 **[실행]**. `herdr status server`는 텍스트로 나왔다 **[실행]**.
- `herdr --machine <label> <command>`가 저장한 ssh 기기로 API 요청을 비대화형 ssh로 보낸다. "API payloads are not interpolated into the SSH shell command", "the bridge never installs, starts, or restarts a server"(cli-reference) **[문서]**.
- `herdr api schema --json`이 소켓 프로토콜의 JSON Schema를 준다 **[문서]**.

## 3. Runner 계약 항목별 대응

판정은 **채움**(도구 기능으로 그대로), **우회**(어댑터가 약속이나 다른 명령으로 메워야 함), **빠짐**(맞는 기능이 없음)이다. Orca 칸은 research 0008의 제안이다.

| 계약 항목                      | Orca(research 0008)                            | hc                                                                                                                                                     | herdr TUI                                                                                                                                   | 판정(hc / TUI) |
| ------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `checkHealth`                  | `orca status`, 상시 서비스 확인                | `hc server status --json`: `version`, `live`, `keeps_running_after_logout`, `logout_linger_user` **[실행]**                                            | `herdr status server`(텍스트) **[실행]**                                                                                                    | 채움 / 우회    |
| `listProjects`                 | Orca에 등록한 저장소                           | 등록 개념 없음. 러너 설정에 저장소 경로를 적어야 한다                                                                                                  | herdr 워크스페이스 목록. 저장소 등록은 아니다                                                                                               | 빠짐 / 우회    |
| 워크트리 만들기                | `worker-start --worktree new-top-level --name` | 없음. `hc exec -- git worktree add ...`나 ssh로 git을 직접 부른다                                                                                      | `worktree create --cwd <저장소> --branch <이름> [--base <ref>]` → `<worktrees.directory>/<repo>/<branch-slug>`에 만든다 **[실행]**          | 우회 / 채움    |
| 결정적 이름으로 찾기·시작 멱등 | `--name`, `operationId`                        | `--name`은 살아 있는 터미널끼리만 유일(`name_taken`) **[실행]**. 끝난 뒤에는 같은 이름을 다시 쓸 수 있다. 재시도 토큰 없음                             | 같은 브랜치로 `create`를 다시 부르면 `worktree_create_failed`. `worktree open --branch`가 같은 워크트리를 연다 **[실행]**. 재시도 토큰 없음 | 우회 / 우회    |
| 브랜치 이름                    | Orca가 접두사를 붙인다(ADR 0009 Consequences)  | 어댑터가 정한 이름 그대로(git 직접)                                                                                                                    | `--branch` 그대로 **[실행]**                                                                                                                | 채움 / 채움    |
| 에이전트 띄우기                | `worker-start --agent`                         | `hc run --bg --name <n> --cwd <워크트리> <명령> "<첫 지시>"`. 아무 프로그램이나 대화형으로 띄운다 **[실행]**. 첫 지시는 인자로 주라고 권한다(SKILL.md) | `agent start <n> --kind <kind> --pane <id> -- <인자>` 뒤 `agent prompt`. kind 24종(claude, codex 등) **[문서]**. 빈 셸 pane이 있어야 한다   | 채움 / 채움    |
| 진행 상태 관측                 | `task-list`, `worker-show`, `check --peek`     | `hc get --json`의 `state`(`live`·`finished`)와 `status`(상태 보고), `hc events` **[실행]**                                                             | `agent get`의 `agent_status`. 화면 규칙으로 정한다 **[문서]**                                                                               | 채움 / 우회    |
| 질문(ask) 읽기                 | `question` 메일(`id`, `body`, `options`)       | `status.state: "blocked"`, `kind: "question"`, `msg`에 질문과 선택지 **[실행]**. 메일 id 없음                                                          | `blocked`. 내용은 `agent read`로 화면을 읽어야 한다                                                                                         | 우회 / 우회    |
| 답하기(reply)                  | `reply --id <msgId> --body`                    | 선택지는 `hc keys <t> down enter`, 글은 `hc send <t> "<답>"`(`blocked`면 `--force`) **[실행]**                                                         | `agent send-keys`, `agent prompt`(`blocked`면 `agent_blocked`로 거절) **[문서]**                                                            | 우회 / 우회    |
| 완료 보고                      | `worker_done --outcome`                        | 없음. `status: "done"`은 턴 끝. 에이전트가 `hc send <우편함> '<보고>'`를 부르게 하는 약속으로 메운다 **[실행]**                                        | 없음. `done`은 "idle but not yet marked seen"                                                                                               | 우회 / 우회    |
| 권한 대기                      | `needs-input` escalation, `deny`만             | `blocked`, `kind: "permission"`, `msg: "approve Bash: touch ..."` **[실행]**. `hc keys <t> esc`로 거절했다. 허용 키도 칠 수 있다                       | `blocked`(화면 규칙). `agent send-keys`                                                                                                     | 채움 / 우회    |
| 보고 없이 사라짐               | `lost` escalation, `liveness`                  | `state: "finished"`, `reason`, `exit_code`, `signal`(schema/README.md의 `finished` 이벤트) **[문서]**. `hc kill`로 끝낸 경우만 실행했다                | 에이전트가 목록에서 빠지고 pane이 셸로 돌아간다 **[문서]**                                                                                  | 채움 / 우회    |
| 멈추기(`stopAgent`)            | `worker-stop`                                  | `hc kill <t>` → `reason: "killed"`, `exit_code: 129` **[실행]**. `hc interrupt`는 멈춤 키를 누른다                                                     | `pane close`, `agent send-keys ctrl+c` **[실행]**·**[문서]**                                                                                | 채움 / 채움    |
| 정리(`removeWorktree`)         | `worker-release` → `worktree rm --force`       | `hc rm <t>`(끝난 터미널만, 살아 있으면 `live`) **[실행]** + git으로 워크트리 지우기                                                                    | `worktree remove --workspace <id> [--force]`. 브랜치는 남긴다 **[실행]**                                                                    | 우회 / 채움    |
| `worktreeExists`               | `worktree show`                                | git으로 확인                                                                                                                                           | `worktree list --cwd <저장소>` **[실행]**                                                                                                   | 우회 / 채움    |
| 로그 꼬리(`readLogTail`)       | `worker-read --limit`                          | `hc read <t> --lines N`(텍스트). `blocked`일 때는 화면만 준다 **[실행]**                                                                               | `agent read --source recent-unwrapped --lines N`. 전체 화면 에이전트의 이전 기록은 idle일 때만 스크롤해 읽는다 **[문서]**                   | 채움 / 채움    |
| 상시 실행                      | `orca serve service install`                   | CLI가 core를 띄운다. Linux systemd에서는 lingering을 켜려 한다. 서비스 설치 명령은 없다 **[문서]**                                                     | `herdr server`(헤드리스), 클라이언트가 서버를 띄운다 **[문서]**                                                                             | 우회 / 우회    |

### 실행에서 본 hc 상태 보고

Claude Code는 hc 안에서 스스로 OSC 7501을 보냈다(`reported: true`) **[실행]**. hc 문서는 "hc never infers status from the screen. Programs that don't speak 7501 have no status"라고 적는다(schema/README.md) **[문서]**.

| 상황                       | `hc get --json`의 `status`                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 처음 보는 폴더의 신뢰 확인 | `{"app":"claude-code","kind":"permission","msg":"trust this folder","state":"blocked"}`                                        |
| 일을 마치고 입력을 기다림  | `{"app":"claude-code","state":"done"}`                                                                                         |
| AskUserQuestion으로 질문   | `{"app":"claude-code","kind":"question","msg":"answer: A와 B 중 어느 쪽으로 할까요? (A (Recommended) · B)","state":"blocked"}` |
| Bash 권한 프롬프트         | `{"app":"claude-code","kind":"permission","msg":"approve Bash: touch made-by-agent.txt","state":"blocked"}`                    |
| 권한을 `esc`로 거절한 뒤   | `{"app":"claude-code","state":"idle"}`(파일은 만들어지지 않았다)                                                               |
| `hc kill` 뒤               | `status: null`, `state: "finished"`, `reason: "killed"`, `exit_code: 129`                                                      |

질문에 `hc keys agent1 down enter`로 B를 고르자 에이전트가 "B로 선택하셨어요"라고 이어 갔고 상태가 `done`이 됐다 **[실행]**. `turn`은 턴마다 1씩 늘었다.

### 실행에서 본 완료 보고 우회

에이전트 없는 터미널 `mbox`(`cat`)를 우편함으로 띄우고, 에이전트를 `--parent mbox`로 띄워 "끝나면 `hc send mbox 'DONE run=42 outcome=succeeded'`를 부르라"고 지시했다 **[실행]**.

- `hc read mbox`에 `DONE run=42 outcome=succeeded`가 찍혔다. 터미널 에코와 `cat` 출력으로 같은 줄이 두 번 보였다.
- 에이전트 쪽 `hc send` 응답은 `{"started":null,"status":null,"turn":0}`이었다. 보낸 쪽은 받았는지 알 수 없다.
- `mbox`를 `hc kill`하자 자식인 에이전트도 `finished`(`reason: "killed"`)가 됐다. 자식은 `--outlive-parent` 없이는 부모와 함께 끝난다(README) **[문서]**.
- 문서는 부모가 자식의 `blocked`, 오류, 끝남에 대해 메모(`<hc from=...>`)를 받는다고 적지만 **[문서]**, 이번 시험에서는 `mbox` 화면에 메모를 보지 못했다.

즉 완료 보고는 터미널에 친 글이다. 메일 id, 소비 여부, 보관이 없고, 화면 기록이 밀리면 사라질 수 있다. 보고를 파일로 남기게 하고 `hc file read`로 읽는 쪽이 더 단단할 수 있지만 시험하지 않았다.

### 실행에서 본 herdr TUI 화면 감지의 한계

격리한 HOME에서 `agent start run-1 --kind claude`를 부르자 `agent_status: "idle"`, `interactive_ready: true`로 돌아왔다. 실제 화면은 Claude Code의 첫 실행 테마 고르기였다 **[실행]**. `agent explain`은 `rule: none`, `fallback_reason: default_known_agent_idle_fallback`이었다. 문서도 "Unusual new agent prompts may initially show as idle instead of blocked", "idle status is not authorization to approve an action"이라 적는다([agents](https://herdr.dev/tui/docs/agents/)) **[문서]**. 이 상태에서 `agent prompt`를 보내면 대화 상자에 입력이 들어간다.

감지 규칙(manifest)은 herdr.dev에서 자동으로 받아 갱신한다. 서버를 띄우자 상태 폴더에 `remote/claude.toml 2026.10.11.1`이 생겼다 **[실행]**. `[update] manifest_check = false`로 끌 수 있다 **[문서]**.

## 4. 우리 결정과 어긋나는 점

1. **운영자가 오케스트레이터 화면에서 질문에 답하기(ADR 0009).** 흐름은 만들 수 있다. 질문은 `blocked`+`kind: "question"`의 `msg`로 읽고, 답은 `hc keys`나 `hc send --force`로 보낸다. 하지만 Orca와 달리 질문은 메시지가 아니라 터미널 상태다. 질문 id가 없어 "이 질문에 답했다"를 상태 시각(`status_ms`)과 `turn`으로 오케스트레이터가 지어야 한다. 선택지 질문의 답은 UI 키 입력이라 선택지 순서와 화면 모양에 기댄다. 에이전트가 AskUserQuestion이 아니라 평문으로 묻고 턴을 끝내면 상태는 `done`이고, 질문과 완료를 가를 수 없다.
2. **완료 보고와 outcome(GLOSSARY 「완료 보고」).** 도구에 없다. `done`은 턴 끝이라, ADR 0009가 기각한 "`done`인 채 N분이면 끝" 문제가 그대로 돌아온다. 에이전트에게 정한 형식으로 보고하라고 지시하는 약속이 필요하다. 보고하지 않고 쉬는 에이전트는 Orca의 아직 모르는 것 1번과 같은 문제다.
3. **권한은 사람만 허용(ADR 0009).** Orca는 ssh로 `deny`만 됐다. hc·herdr TUI는 키 입력이라 허용도 칠 수 있다. `hc send`는 `blocked`에 입력을 거절하지만 `--force`와 `hc keys`는 막지 않는다. 지금 결정을 지키려면 어댑터가 권한 대기에서는 거절 키만 보내도록 스스로 막아야 한다.
4. **비대화형 ssh에서 GitHub 인증(스펙 9절).** 러너 환경의 문제라 Orca와 같다. 더할 점이 둘이다.
   - macOS에서 ssh나 백그라운드 작업으로 띄운 herdr 서버는 키체인에 닿지 못할 수 있다고 문서가 적는다([troubleshooting](https://herdr.dev/tui/docs/troubleshooting/), herdr 저장소 #966) **[문서]**. hc도 "on macOS, whether it starts from SSH or launchd"를 띄운 쪽이 정한다(README) **[문서]**. research 0003의 우회(`gh auth login --insecure-storage`)가 그대로 필요할 것으로 보이지만 러너에서 확인하지 않았다.
   - core는 처음 띄운 프로세스의 환경을 계속 쓴다(README "Updates and `hc server restart` keep the environment the core started with") **[문서]**. 실행에서 hc 안의 Claude Code가 core를 띄운 이 세션의 환경 변수를 물려받아 "Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker"를 띄웠다 **[실행]**. 러너에서 오케스트레이터의 ssh가 core를 처음 띄우면 비대화형 ssh 환경이 모든 런에 남는다. Linux에서는 ssh로 띄운 core가 로그인 셸의 비대화형 환경을 한 번 읽는다(SKILL.md) **[문서]**.
5. **결정적 이름으로 시작 멱등(ADR 0009 Consequences).** 이름은 살아 있는 것끼리만 유일하다. 시작 응답을 잃었을 때 `hc get <이름>`으로 다시 찾을 수는 있지만, 이미 끝난 런과 새 런을 이름만으로 가를 수 없다. 재시도 토큰(Orca `operationId`)은 없다. 워크트리는 herdr TUI에서 브랜치로 다시 찾을 수 있다.

## 5. Orca 어댑터와 비교

| 축                | Orca(research 0008)                                       | hc                                                                 |
| ----------------- | --------------------------------------------------------- | ------------------------------------------------------------------ |
| 대화 채널         | 오케스트레이션 메일함(`question`, `worker_done`, `reply`) | 터미널 입력과 상태 보고. 메일함 없음                               |
| 끝 판정           | `worker_done`의 outcome                                   | 약속한 보고 글. 도구에는 `done`(턴 끝)과 `finished`(프로세스 끝)뿐 |
| 상태 근거         | Orca의 관측(`liveness`, `activity`)                       | 에이전트의 OSC 7501 보고. 보고하지 않는 에이전트는 상태가 없다     |
| 권한              | `deny`만                                                  | 키 입력. 허용도 가능                                               |
| 워크트리          | Orca가 만든다(브랜치에 접두사)                            | 없음(herdr TUI는 정한 브랜치 그대로)                               |
| 우편함 신원       | 필요(ssh 호출자에 신원이 없음)                            | 필요 없음. 보고를 받을 터미널은 약속으로 둔다                      |
| 지울 수 없는 기록 | 오케스트레이션 Run·`Task`가 쌓인다                        | `hc rm`으로 끝난 터미널을 지운다                                   |
| 성숙도            | Orca 1.4.x                                                | 0.1.x, API preview                                                 |

## 6. 두 번째 러너로 만들 때 core 계약에서 바뀌어야 할 점

ADR 0008대로 어댑터 패키지(예: `packages/runner-herdr`)와 등록 한 줄로 더하려면, core 계약이 Orca의 모양에 묶이지 않아야 한다. 0037에서 계약을 정할 때 볼 점이다.

1. **질문 식별자.** 계약이 질문을 러너의 메시지 id(`msgId`)로 다루면 hc에는 맞는 값이 없다. 질문 식별자는 어댑터가 만드는 불투명한 값으로 두고(hc는 터미널+`status_ms`+`turn` 같은 조합), "답했음"은 지금처럼 오케스트레이터 DB가 기준이어야 한다.
2. **답의 모양.** Orca는 글 하나(`--body`)를 보낸다. hc에서 선택지 질문은 키 입력이다. 계약의 답은 글로 두고, 선택지를 키로 바꾸는 일은 어댑터 몫으로 둔다. 화면에 보일 선택지가 계약에 있으면(`options`) hc는 `msg`를 파싱해야 한다.
3. **완료 보고의 출처.** 계약은 "에이전트가 outcome과 함께 완료를 알렸다"만 말하고, 그것이 도구 기능(Orca)인지 어댑터의 약속(hc)인지는 묻지 않아야 한다. 어댑터가 첫 지시에 보고 약속을 덧붙이므로, `StartRunInput.prompt`가 티켓 내용만이라는 GLOSSARY 규칙과 어떻게 맞출지 정해야 한다(Orca도 사양에 보고 규칙이 들어간다).
4. **권한 처리.** 계약을 "거절만"으로 두면 hc에서도 그대로 지킬 수 있다. 허용까지 열지는 정책 결정이다.
5. **러너 필수 조건.** hc 러너는 "에이전트가 OSC 7501을 보고한다"가 필수 조건이 된다(에이전트와 버전). `RunnerPrerequisite`로 담을 수 있다. 우편함 터미널·오케스트레이션 Run은 Orca 어댑터 안에만 두면 된다.
6. **`RunProgress.finished.exitCode`.** main의 `finished`는 종료 코드를 가진다. hc는 프로세스가 끝나면 `exit_code`·`signal`·`reason`을 주므로 "보고 없이 사라짐"을 가르는 데 쓸 수 있다. 0037에서 이 자리를 완료 보고로 바꿀 때 hc의 값도 담을 수 있게 둔다.
7. **`listProjects`.** hc에는 저장소 등록이 없다. 러너 쪽 프로젝트 목록을 러너 설정(어댑터 config)에서 읽어도 되도록, 이 메서드가 러너에 물어야 한다고 가정하지 않는다.

## 7. 로컬 시험과 정리

- 설치하지 않고 내려받기만 했다. hc는 `releases.herdr.dev`의 tar.gz(매니페스트 SHA-256 확인), herdr TUI는 GitHub 릴리스 바이너리를 스크래치 폴더에 두고 경로로 실행했다. PATH, Homebrew, `~/.local/bin`에는 넣지 않았다.
- hc는 `HC_SESSION`, `XDG_STATE_HOME`, `XDG_CONFIG_HOME`, `XDG_RUNTIME_DIR`를 스크래치로, `HC_SOCKET`을 짧은 임시 경로로 두었다. macOS의 소켓 경로 한계(103바이트)에 걸려 `HC_SOCKET`이 필요했다 **[실행]**. herdr TUI는 `HOME`, `XDG_*`, `HERDR_SOCKET_PATH`를 따로 두었다.
- 끝난 뒤 `hc server stop`, `herdr server stop`으로 서버를 멈췄고, 남은 herdr 프로세스와 launchd 작업이 없음을 확인했다. 실제 HOME에 herdr·hc 파일은 생기지 않았다. 임시 소켓, 스크래치 폴더의 바이너리·상태, 시험 저장소를 지웠다.
- Claude Code 시험이 실제 `~/.claude/projects`에 남긴 시험 폴더 기록은 지웠다. `~/.claude.json`에 시험 폴더(지운 경로)의 신뢰 기록 한 줄이 남았다. 실행 중인 Claude Code가 같은 파일을 쓰므로 고치지 않았다.

## 운영자가 정할 것

1. **어느 herdr인가.** 헤드리스 런타임 hc(상태 보고 기반, 0.1.x preview, 워크트리 없음)인지, herdr TUI 서버(화면 감지, 워크트리 명령, 더 오래됨)인지. 사이트의 중심이 app·core로 옮겨 간 점도 함께 본다.
2. **완료 보고 약속.** 에이전트가 무엇으로 보고하는지(우편함 터미널에 `hc send`, 워크트리의 보고 파일 등)와 그 지시를 첫 지시에 넣는 방식.
3. **권한 정책.** 키 입력으로 허용까지 할 수 있는 러너에서도 "허용은 사람만"을 지킬지.
4. **상태를 보고하지 않는 에이전트.** hc에서는 상태가 없다. 그런 에이전트를 막을지, 끝(`finished`)만 보는 약한 모드로 받을지.

## 아직 모르는 것

1. 러너(다른 기기)에서 비대화형 `ssh <host> 'hc ... --json'`과 `ssh <host> hc connect`. 이번에는 오케스트레이터 기계 로컬에서만 돌렸다.
2. ssh로 처음 띄운 core에서 키체인·`gh` 인증과 Claude Code 로그인이 동작하는지.
3. Linux 러너. systemd lingering(`keeps_running_after_logout`)과 Linux의 상태 보고.
4. Codex 등 다른 에이전트가 OSC 7501을 보고하는지. hc 매뉴얼은 Codex를 `--no-daemon`으로 띄우라고 한다 **[문서]**.
5. Claude Code가 `error` 상태를 언제 보고하는지, 평문으로 묻고 턴을 끝낼 때 `done`과 구별할 길이 있는지.
6. 부모 메모(`<hc from=...>`)가 언제 우편함에 찍히는지. 이번 시험에서는 보지 못했다.
7. 선택지 질문에 자유 글로 답하기(`Type something` 고른 뒤 `hc send --force`).
8. core·러너 재부팅 뒤의 상태. 문서상 프로그램은 살아남지 않고, hc `--keep`은 새 셸만 띄운다. herdr TUI는 공식 통합을 깔면 `claude --resume`으로 대화를 잇는다 **[문서]**.
9. hc의 `hc events` 스트림을 ssh로 오래 붙잡을 때의 끊김과 재연결.
10. 0.1.x에서 API가 깨지지 않는다는 약속이 실제로 지켜지는지.
