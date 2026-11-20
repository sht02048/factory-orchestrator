---
status: done
blocked_by: []
---

# 0135 runs-query e2e 흔들림

## 목표

0125(PR #169)가 더한 `e2e/src/runs-query.test.ts`가 CI 에서 거의 매번 실패해 develop 과 다른 PR 을 막는다. 0121·0131 처럼 제한 시간을 늘리거나 재시도를 켜지 않고, 시험이 기다리는 조건을 바로잡는다. 원인이 제품에 있으면 제품을 고친다.

## 배경

2026-11-20 CI 에서 세 시험이 번갈아 실패했다.

- '로그 받는 중 폴링 15번이 끝나도 로그가 오지 않으면 다시 요청하는 길을 보인다(가짜 시계)': `expected 3 to be 4`, `Matcher did not succeed in time`(develop push run 44662646202 등). 셈이 늘 하나 모자란다.
- '서버 렌더한 Runs와 Run 상세는 hydration이 끝날 때까지 자기 서버 함수를 다시 부르지 않는다': `expected Set{} to deeply equal Set{ 'requestRunLog' }`(PR #171 run 44664012329 첫 시도).
- '취소 하나 뒤에는 그 런의 상세만 다시 읽고 루트와 셸은 다시 읽지 않는다': `expected [ 'requestRunLog', …(3) ] to deeply equal [ 'cancelRun', 'getRunDetail' ]`(run 44664322539).

같은 실행에 찍힌 `Error: aborted`(`ECONNRESET`)는 앞 시험의 페이지가 요청 중에 닫히며 서버에 남는 기록이다. 실패의 원인은 아니다.

## 원인

모두 시험 쪽 경쟁이다. 제품은 고치지 않았다.

### 상세를 연 뒤 로그 요청을 기다리지 않았다

- Run 상세는 hydration 이 끝난 뒤 effect 에서 `openLog`(`requestRunLog`)를 부르고, 로그를 새로 요청했으면 상세를 다시 읽는다(`getRunDetail`). 그다음 `logRequested`로 폴링 셈의 시작점을 잡는다.
- 시험의 `open()`은 `networkidle`(요청이 500ms 동안 없음)까지만 기다렸다. 부하로 브라우저의 hydration 이 늦으면 모듈을 다 받고 500ms 가 지난 뒤에야 effect 가 돈다. 그래서 `open()`이 돌아온 뒤에 `requestRunLog`와 다시 읽기가 시험의 관찰 구간에 들어왔다.
  - hydration 시험: 아직 `requestRunLog`를 부르지 않아 빈 집합이었다.
  - 취소 시험: 비운 뒤의 기록에 늦게 온 `requestRunLog`와 다시 읽기가 섞였다.
  - 폴링 시험: 다시 읽기가 폴링 도중에 끼어 셈이 어긋났다(`expected 2 to be 1`).

### 폴링 응답을 페이지가 처리하기 전에 시계를 돌렸다

- `refetchInterval`은 Query 가 바뀔 때마다(`QueryObserver.onQueryUpdate` → `#updateTimers`) 타이머를 지금 시각에서 다시 건다. 진행 중인 읽기가 있으면 그 사이의 타이머 tick 은 새 요청 없이 진행 중인 읽기에 묻힌다(`Query.fetch`).
- 시험은 매 폴링마다 요청이 나간 것과 `networkidle`만 보고 가짜 시계를 2초 돌렸다. 응답은 네트워크에서는 끝났지만 페이지의 JS 가 아직 처리하지 않았으면, 그 2초의 tick 은 진행 중인 읽기에 묻힌다. 그 뒤에 응답을 처리하면 타이머가 멈춘 시계의 지금 시각에서 다시 걸려 시계를 2초 더 돌리기 전에는 요청이 나가지 않는다. 셈이 하나 모자란 이유다.
- 실제 시계에서는 다음 tick 이 2초 뒤에 오므로 폴링이 멈추지 않는다. 제품 버그가 아니다.

## 고친 것

- `e2e/src/query-settled.ts` `waitForScreenQuerySettled(page, queryKey)`: 화면의 Query 에 observer 가 붙었고(컴포넌트가 hydration 을 마치고 그렸다) 읽기와 mutation 이 하나도 진행 중이지 않을 때까지 기다린다. `__TSR_ROUTER__`의 라우터 context 에 있는 `queryClient`를 본다.
- `open()`이 `networkidle` 뒤에 그 화면의 Query(Runs 목록 또는 그 런의 상세)가 가라앉기를 기다린다. 상세의 `openLog`와 그 뒤 다시 읽기가 끝난 다음에 시험이 시작한다.
- 로그 폴링 시험은 매 폴링 뒤 `networkidle` 대신 상세 Query 가 가라앉기를 기다린 다음 시계를 돌린다. 30초 폴링 시험도 첫 폴링 뒤 같은 조건을 기다린다.

## 완료 조건

- [x] 고치기 전 실패를 재현한다.
  - 이 파일만 6개 동시 실행 + CPU 부하(`yes` 12개) 12회 중 2회 실패(폴링 시험, `expected 8 to be 9`, `expected 9 to be 10`).
  - 시험 페이지에 CDP CPU 감속(10배·20배)을 걸면 4회 모두 hydration·취소·폴링 세 시험이 CI 와 같은 메시지로 실패한다.
- [x] 같은 조건에서 고친 시험이 5회 넘게 통과한다.
  - CDP CPU 20배 감속 8회(10배 1회 포함 9회) 모두 8/8 통과.
  - 6개 동시 실행 + CPU 부하 18회 0 실패.
- [x] 로컬 전체 e2e 는 돌리지 않고 CI `check`에 맡긴다.
