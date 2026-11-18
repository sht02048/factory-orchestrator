---
status: done
blocked_by: []
---

# 0061 e2e 브라우저 시험 시간 초과 안정화

## 목표

CI `check`의 e2e 브라우저 시험이 시간 초과로 흔들리는 원인을 증거로 확정하고 고친다.

## 문제

CI `check`의 e2e 브라우저 시험이 자주 시간 초과로 실패한다. 같은 증상이 여러 번 났다.

- main 5549661(PR #86 머지) CI: 처음 실행과 재실행 모두 `e2e/src/home.test.ts`의 `hydrated()` 안 `page.waitForFunction`(`__TSR_ROUTER__`)이 110초를 넘겨 실패했다.
- PR #87(문서만 바꿈): 같은 `home.test.ts` 시간 초과로 실패했다가 재실행에서 통과했다.
- PR #83(0055): `home.test.ts` `beforeAll` 준비 시간 초과가 한 번 났다.
- 이전에 demo `dev.test.ts`의 클릭 시간 초과가 한 번 났다.

처음 추정은 화면별 e2e 파일이 저마다 vite dev 서버를 띄우고 vitest가 파일을 병렬로 돌려 CI 러너에서 콜드 스타트와 하이드레이션이 몰린다는 것이었다. 확인되지 않은 추정이라 먼저 재현해 원인을 확정한다.

## 범위

- 원인을 확정하고 고친다. 후보는 e2e 파일들이 dev 서버 하나를 함께 쓰게 하기(globalSetup), e2e 프로젝트만 파일을 차례로 돌리기, 서버 준비 대기를 콜드 스타트에 맞게 고치기다. 원인이 아니면 시험 시간만 크게 늘리는 해법은 쓰지 않는다.
- 고칠 파일: `e2e/**`(시험 도우미, 설정, 각 e2e 시험 파일의 서버 준비 부분), 루트와 e2e의 vitest 설정, 필요하면 `.github/workflows`. 앱 코드(`apps/**`, `packages/**`)와 화면 동작은 고치지 않는다. 시험이 확인하는 내용(단언)은 바꾸지 않는다.
- 0060이 같은 때에 Dashboard 화면을 구현한다. 0060은 이 티켓이 머지될 때까지 `e2e/**`를 고치지 않는다.

## 완료 조건

- 로컬에서 전체 e2e를 CI와 비슷한 조건(동시 실행)으로 세 번 돌려 모두 통과한 기록.
- PR의 CI `check`가 같은 head에서 두 번 통과한다.
- 전체 e2e 실행 시간이 이전보다 크게 늘지 않았다는 전후 수치.

## 원인

e2e 파일마다 띄우는 vite dev 서버가 의존성 최적화 캐시 `apps/web/node_modules/.vite`를 함께 썼다. 병렬 실행이나 콜드 스타트 자체가 원인이 아니다.

- vite는 캐시 해시에 플러그인 이름을 넣는다. e2e 파일은 플러그인 묶음이 셋이다(`e2e-fake-adapters` 8개, settings의 `e2e-settings-adapters`, thin-path의 플러그인 없음). demo `pnpm dev`도 같은 캐시를 쓰고 플러그인이 또 다르다.
- 해시가 다른 서버가 뜨면 공유 캐시를 지우고 다시 만든다. 그때 첫 페이지를 읽던 다른 서버는 의존성 요청에 `504 Outdated Optimize Dep`을 받는다. vite는 다시 읽으라는 신호를 HMR로 보내는데 e2e 서버는 `hmr: false`라, 페이지가 하이드레이션하지 못한 채 시간 초과까지 기다린다.
- 재현: 플러그인 이름만 다른 서버 둘을 같은 캐시로 띄우고 첫 페이지 읽기와 둘째 서버 시작을 겹치면, 8번 중 2번 `react.js` 등에 504를 받고 하이드레이션하지 못했다. 서버마다 캐시를 따로 주면 8번 모두 1초 안에 하이드레이션했다.
- main에서 전체 시험을 CI처럼 돌린 세 번 중 한 번이 CI와 같은 모양으로 실패했다(`home.test.ts`·`settings.test.ts` 준비의 `__TSR_ROUTER__` 110초 초과, demo `dev.test.ts`의 `hydrated` 시간 초과).

## 고친 것

- e2e 서버 준비를 `e2e/src/web-server.ts`의 `startWebServer` 하나로 모으고, 시험 파일의 임시 폴더를 `cacheDir`로 준다. e2e 서버는 서로의 캐시도, demo가 쓰는 `apps/web`의 캐시도 건드리지 않는다.
- `e2e/src/web-server.test.ts`가 플러그인이 다른 서버가 떠도 먼저 뜬 서버의 캐시가 그대로인지, e2e 시험 파일이 vite `createServer`를 직접 부르지 않는지 확인한다.
- PR CI 재실행에서 다른 흔들림이 하나 더 드러났다. 토스트 문구를 페이지 전체에서 `getByText`로 찾는데, UI SDK가 같은 문구를 스크린 리더용 알림(`role="status"`, `data-ui-sdk-announcer`)에도 넣어, 알림이 문구를 가진 때에 맞물리면 요소 두 개에 걸려 strict mode 위반으로 실패했다. 토스트와 스크린 리더 알림에 같은 문구가 있는 것은 접근성상 맞는 동작이라 화면 버그가 아니고, 캐시 변경과 무관하게 원래 있던 경합이다. 토스트를 기다리는 곳(`tickets` 두 곳, `operator-actions`, `onboarding`)을 토스트 영역(`shell.toastRegion`) 안에서 찾게 좁혔다.
- 시험 시간 제한과 단언은 바꾸지 않았다.
