---
status: done
blocked_by: []
---

# 0136 흔들리는 시험 지우기

## 목표

자기 PR 탓이 아닌데 CI 에서 흔들린 시험을 고치지 않고 지운다(운영자 결정, 2026-11-20: "흔들리는 테스트는 그냥 제거해."). `.skip`·`.only`로 꺼 두지 않고 시험 코드를 지운다. 새 시험을 대신 쓰지 않는다.

## 확인한 방법

- CI 워크플로의 실패 실행 중 run 44666327159(2026-11-20 03:14 UTC)까지의 30개(`gh run list --workflow CI`)와 다시 돌린 실행의 첫 시도 로그, 코디네이터가 더한 run 44674241278 첫 시도 로그(`actions/runs/<id>/attempts/1/logs`)에서 실패한 시험 이름을 모았다.
- 이미 고쳐 그 뒤 CI 에서 흔들리지 않은 시험은 지우지 않았다. 0121: nav-shortcuts·desktop-updates 토스트. 0131: Settings 목차, desktop 알림 설정·화면 전환, demo 온보딩 모드. 0135: runs-query.

## 지운 시험과 잃은 확인 범위

- `e2e/src/settings.test.ts` '맞지 않는 분 값은 넣은 값을 그대로 두고 오류를 그 칸에 잇는다'
  - CI: PR #173(0135, Settings 를 바꾸지 않음) run 44667986940 첫 시도에서 실패, 다시 돌려 통과.
  - 잃은 확인: Enter 로 맞지 않는 분 값(0)을 넣으면 칸에 넣은 값이 그대로 남고, 오류 문장이 그 칸의 `aria-describedby`로 이어지며, 맞는 값을 넣으면 오류가 사라진다.
  - 남은 확인: 같은 파일 '최대 실행 시간은 칸을 벗어나면 바로 저장하고, 맞지 않는 값은 저장하지 않고 알린다'가 오류 문장·`aria-invalid`·저장을 본다. `apps/web/src/settings/settings.test.tsx` '최대 실행 시간 칸은 숫자 키보드를 쓰고, 처음 열 때는 오류를 보이지 않는다(0055)'가 칸의 처음 상태를 본다. 넣은 값 유지와 `aria-describedby` 연결은 이제 시험하지 않는다.
- `e2e/src/runs.test.ts` '주소의 조건으로 거르고, 끝난 런 상한은 조건 안에서 적용하며, 칩을 지우면 포커스가 남은 칩으로 간다'
  - CI: PR #170(0126, Dashboard·Stats) run 44662245743 에서 실패(포커스가 body), 같은 브랜치의 다음 실행(run 44664322539)에서 이 시험은 통과했지만, 그 사이에 develop(0125·0131)을 받아 코드가 달랐다. CI 실패 근거는 이 한 번뿐이다.
  - 잃은 확인: 브라우저에서 주소의 조건이 조건 칩 줄로 보이고 목록을 거르는 것, 칩 하나를 지우면 포커스가 남은 칩으로, 모두 지우면 상태 탭으로 가는 것.
  - 남은 확인: `apps/web/src/runs/load.test.ts`가 러너·에이전트·기간 조건과 '끝난 런 상한은 조건 안에서 적용하고, 조건 밖 런은 담지 않는다'를, `apps/web/src/runs/conditions.test.ts`가 주소에서 조건 고르기를, `apps/web/src/runs/runs-screen.test.tsx` '걸린 조건을 지울 수 있는 버튼 줄로 보이고…(0075)'가 칩 줄 그리기를 본다. 칩을 지운 뒤 포커스가 옮겨 가는 것은 이제 시험하지 않는다.
- `e2e/src/runner-setup.test.ts` '직접 입력에서 orca 경로를 비우면 ssh로 찾고, 닿지 않으면 저장하지 않고 이유를 보인다'
  - CI: develop run 44532323728, main run 44498773104·44495295652, PR #157(0116) run 44517236715 에서 실패. 네 번 모두 '확인하고 등록' 버튼이 꺼진 채(이름·프로젝트를 읽기 전) 30초 동안 켜지지 않아 누르지 못했다. 0131 은 로컬 부하에서 다른 방식(실제 `ssh`로 `nowhere.invalid`에 닿지 못하기를 기다리다 30초 초과)을 재현했다.
  - 잃은 확인: 실제 서버와 브라우저에서 orca 경로를 비우고 등록하면 ssh 실패 경고를 보이고 러너를 저장하지 않는 것.
  - 남은 확인: `packages/app/src/runner-setup/remote-orca.test.ts`가 ssh 실패와 orca 없음 구분('tells an ssh failure apart from a missing orca'), 찾지 못하면 저장하지 않기('saves nothing when orca cannot be found')를 가짜 ssh 로 본다. 화면의 경고 문장은 이제 시험하지 않는다.

- `apps/cli/src/start.test.ts`·`apps/cli/src/mcp/program-mcp.test.ts`의 시험 넷(코디네이터가 더한 후보)
  - CI: PR #170(0126, Dashboard·Stats) run 44674241278 첫 시도에서 넷 모두 5초 시간 초과(`Test timed out in 5000ms`). 실제 자식 프로세스나 stdio MCP 서버를 띄우는 시험이라 부하에 밀린다. 단독으로는 통과한다.
  - `start` '마이그레이션을 돌린 뒤 web이 바인딩 주소에서 응답한다'
    - 잃은 확인: 첫 start 가 모든 마이그레이션을 돌리고 DB 에 남기며, web 이 `.env`의 포트에서 응답하고, 멈추면 실패 없이 끝나는 것.
    - 남은 확인: 같은 파일 '다시 띄우면 돌릴 마이그레이션이 없다'가 start 와 web 응답을, CI `smoke:cli`·`smoke:bundle`(`scripts/smoke-cli.ts`)이 실제 `ganger start`로 web 과 worker 가 뜨는 것을 본다. 처음 돌린 마이그레이션 목록, `schema_migrations` 행 수, `started.url`이 `.env` 포트와 같은 것, 멈춘 뒤 `exited`가 `{}`인 것은 이제 시험하지 않는다.
  - `start` '뜨는 중에 멈추라는 신호를 받으면 web을 더 기다리지 않고 자식을 멈춘다'
    - 잃은 확인: web 이 응답하기 전에 멈추라는 신호를 받으면 기다림을 끝내고 `stop requested`로 실패하는 것.
    - 남은 확인: 같은 파일 'web이 응답하는 중에 신호를 받으면 뜬 것으로 치지 않고 멈춘다'가 응답 중의 신호를 본다. 응답하지 않는 web 을 기다리는 중의 신호는 이제 시험하지 않는다.
  - `start 의 worker 깨우기 중계` '출력을 넘겨받을 때 web 이 보낸 { type: wake } 만 worker 에 닿는다'(`it.each`의 한 줄)
    - 잃은 확인: `onOutput`으로 자식 출력을 넘겨받을 때도 web 의 깨우기 메시지가 worker 에 닿는 것.
    - 남은 확인: '출력을 그대로 둘 때 web 이 보낸 { type: wake } 만 worker 에 닿는다'가 같은 중계를 본다. 한 줄만 남은 `it.each`는 평범한 `it`으로 바꿨다.
  - `ganger mcp` '실제 SDK 클라이언트로 stdio에 붙으면 … 질문에 답하고 기록을 남긴다'
    - 잃은 확인: 실제 MCP SDK 클라이언트가 stdio 로 붙어 스위치를 켜면 `tools/list_changed` 알림을 받고, 쓰기 도구로 답을 저장하고 MCP 기록을 남기는 것.
    - 남은 확인: `apps/cli/src/mcp/write-tools.test.ts` '켜면 다시 시작하지 않아도 쓰기 도구가 보이고, 끄면 다시 사라진다', '질문에 답하면 답을 저장하고, Run 상세 상태 기록 사이에 MCP · 클라이언트 이름으로 남긴다'와 같은 파일 '판이 같으면 stdin·stdout으로 MCP를 주고받고…'가 본다. SDK 클라이언트와 stdio 로 주고받는 알림은 이제 시험하지 않는다.
    - 이 시험만 쓰던 `PipeClientTransport`와 import 를 함께 지웠다.
- `apps/cli/src/start.test.ts` '한쪽이 먼저 끝나면 다른 쪽도 멈추고 이유를 알린다'(독립 리뷰가 더한 후보)
  - CI: PR #80(0050, Home 화면, CLI 를 바꾸지 않음) run 44241958153 에서 web 이 응답하기 전에 `worker exited with code 3`로 실패. 이 흔들림을 고친 티켓은 없다.
  - 잃은 확인: worker 가 먼저 끝나면 start 가 web 도 멈추고 멈춘 이유를 `exited`로 알리며, 그 뒤 web 주소가 응답하지 않는 것.
  - 남은 확인: 같은 파일 'worker 가 끝난 뒤 web 이 보낸 신호는 멈춘 이유를 바꾸지 않는다'가 worker 가 끝나면 `exited`가 그 이유를 갖는 것을, '한쪽이 먼저 끝나 서버가 멈춰도 푼다'가 한쪽이 끝나면 서버가 멈추는 것을 본다. 멈춘 뒤 web 주소가 닫히는 것은 이제 시험하지 않는다.

## 확인하지 못해 남긴 것

CI 실패 기록에서 찾지 못해 지우지 않았다. 다시 CI 에서 흔들리면 지운다.

- `e2e/src/settings.test.ts` '바로 저장하는 스위치는 저장하지 못하면 원래 값으로 되돌리고 이유를 보인다'·'…화면이 새 값을 늦게 읽어도…'(0125 보고): CI 실패 기록 없음.
- `/ds` 탭 e2e(`e2e/src/ds.test.ts`, 0130 보고): CI 실패 기록 없음.
- `apps/desktop` `local-server.test.ts` ServerWatch: CI 실패 기록 없음(0131 에서도 재현하지 못함).

## 범위 밖으로 본 것

같은 기록에서 이 티켓 후보가 아닌 흔들림도 보였다. 이미 고친 티켓이 있어 지우지 않는다.

- `e2e/src/nav-shortcuts.test.ts` '데스크톱 메뉴가 보낸 화면으로…'(PR #157, 2026-11-19 두 번): 0121 이 고쳤다.
- `e2e/src/desktop-updates.test.ts` '다른 토스트가 와도 밀려나지 않고…'(PR #157 첫 시도): 0121 이 고쳤다.
- `demo/src/dev.test.ts` '온보딩 모드: 가짜 값으로 5단계를 마치면 홈이 열린다'(PR #166 첫 시도): 0131 이 고쳤다.

## 완료 조건

- [x] 위 시험을 지우고 `.skip`·`.only`를 남기지 않는다.
- [x] 지운 시험마다 잃은 확인 범위와 남은 단위 시험을 적는다.
- [x] 로컬에서 typecheck·lint·format 과 바뀐 시험 파일을 돌린다. 전체 시험은 CI `check`에 맡긴다.
