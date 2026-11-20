---
status: done
blocked_by: []
---

# 0136 흔들리는 시험 지우기

## 목표

자기 PR 탓이 아닌데 CI 에서 흔들린 시험을 고치지 않고 지운다(운영자 결정, 2026-11-20: "흔들리는 테스트는 그냥 제거해."). `.skip`·`.only`로 꺼 두지 않고 시험 코드를 지운다. 새 시험을 대신 쓰지 않는다.

## 확인한 방법

- 2026-11-20 기준 CI 워크플로의 실패 실행 30개(`gh run list --workflow CI`)와 다시 돌린 실행의 첫 시도 로그(`actions/runs/<id>/attempts/1/logs`)에서 실패한 시험 이름을 모았다.
- 0121·0131·0135 가 이미 고쳐 그 뒤 CI 에서 흔들리지 않은 시험(Settings 목차, runs-query, desktop 알림 설정·화면 전환)은 지우지 않았다.

## 지운 시험과 잃은 확인 범위

- `e2e/src/settings.test.ts` '맞지 않는 분 값은 넣은 값을 그대로 두고 오류를 그 칸에 잇는다'
  - CI: PR #173(0135, Settings 를 바꾸지 않음) run 44667986940 첫 시도에서 실패, 다시 돌려 통과.
  - 잃은 확인: Enter 로 맞지 않는 분 값(0)을 넣으면 칸에 넣은 값이 그대로 남고, 오류 문장이 그 칸의 `aria-describedby`로 이어지며, 맞는 값을 넣으면 오류가 사라진다.
  - 남은 확인: 같은 파일 '최대 실행 시간은 칸을 벗어나면 바로 저장하고, 맞지 않는 값은 저장하지 않고 알린다'가 오류 문장·`aria-invalid`·저장을 본다. `apps/web/src/settings/settings.test.tsx` '최대 실행 시간 칸은 숫자 키보드를 쓰고, 처음 열 때는 오류를 보이지 않는다(0055)'가 칸의 처음 상태를 본다. 넣은 값 유지와 `aria-describedby` 연결은 이제 시험하지 않는다.
- `e2e/src/runs.test.ts` '주소의 조건으로 거르고, 끝난 런 상한은 조건 안에서 적용하며, 칩을 지우면 포커스가 남은 칩으로 간다'
  - CI: PR #170(0126, Dashboard·Stats) run 44662245743 에서 실패(포커스가 body), 같은 브랜치의 다음 실행(run 44664322539)에서 이 시험은 통과.
  - 잃은 확인: 브라우저에서 주소의 조건이 조건 칩 줄로 보이고 목록을 거르는 것, 칩 하나를 지우면 포커스가 남은 칩으로, 모두 지우면 상태 탭으로 가는 것.
  - 남은 확인: `apps/web/src/runs/load.test.ts`가 러너·에이전트·기간 조건과 '끝난 런 상한은 조건 안에서 적용하고, 조건 밖 런은 담지 않는다'를, `apps/web/src/runs/conditions.test.ts`가 주소에서 조건 고르기를, `apps/web/src/runs/runs-screen.test.tsx` '걸린 조건을 지울 수 있는 버튼 줄로 보이고…(0075)'가 칩 줄 그리기를 본다. 칩을 지운 뒤 포커스가 옮겨 가는 것은 이제 시험하지 않는다.
- `e2e/src/runner-setup.test.ts` '직접 입력에서 orca 경로를 비우면 ssh로 찾고, 닿지 않으면 저장하지 않고 이유를 보인다'
  - CI: develop run 44532323728, main run 44498773104·44495295652, PR #157(0116) run 44517236715 에서 실패. 실제 `ssh`로 `nowhere.invalid`에 닿지 못하기를 기다려 부하에서 30초를 넘긴다(0131 에서 재현).
  - 잃은 확인: 실제 서버와 브라우저에서 orca 경로를 비우고 등록하면 ssh 실패 경고를 보이고 러너를 저장하지 않는 것.
  - 남은 확인: `packages/app/src/runner-setup/remote-orca.test.ts`가 ssh 실패와 orca 없음 구분('tells an ssh failure apart from a missing orca'), 찾지 못하면 저장하지 않기('saves nothing when orca cannot be found')를 가짜 ssh 로 본다. 화면의 경고 문장은 이제 시험하지 않는다.

## 확인하지 못해 남긴 것

CI 실패 기록에서 찾지 못해 지우지 않았다. 다시 CI 에서 흔들리면 지운다.

- `e2e/src/settings.test.ts` '바로 저장하는 스위치는 저장하지 못하면 원래 값으로 되돌리고 이유를 보인다'·'…화면이 새 값을 늦게 읽어도…'(0125 보고): CI 실패 기록 없음.
- `/ds` 탭 e2e(`e2e/src/ds.test.ts`, 0130 보고): CI 실패 기록 없음.
- `apps/desktop` `local-server.test.ts` ServerWatch: CI 실패 기록 없음(0131 에서도 재현하지 못함).

## 범위 밖으로 본 것

같은 기록에서 이 티켓 후보가 아닌 흔들림도 보였다. 지우지 않고 남긴다.

- `e2e/src/nav-shortcuts.test.ts` '데스크톱 메뉴가 보낸 화면으로…'(PR #157, 2026-11-19 두 번)
- `e2e/src/desktop-updates.test.ts` '다른 토스트가 와도 밀려나지 않고…'(PR #157 첫 시도)
- `demo/src/dev.test.ts` '온보딩 모드: 가짜 값으로 5단계를 마치면 홈이 열린다'(PR #166 첫 시도)

## 완료 조건

- [x] 위 세 시험을 지우고 `.skip`·`.only`를 남기지 않는다.
- [x] 지운 시험마다 잃은 확인 범위와 남은 단위 시험을 적는다.
- [x] 로컬에서 typecheck·lint·format 과 바뀐 시험 파일을 돌린다. 전체 시험은 CI `check`에 맡긴다.
