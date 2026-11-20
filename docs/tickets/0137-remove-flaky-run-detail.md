---
status: done
blocked_by: []
---

# 0137 흔들리는 시험 지우기(Run 상세 요청 실패 문구)

## 목표

자기 PR 탓이 아닌데 CI 에서 흔들린 Run 상세 e2e 시험 하나를 고치지 않고 지운다(운영자 결정, 2026-11-20, 0136 과 같음). `.skip`·`.only`로 꺼 두지 않고 시험 코드를 지운다. 새 시험을 대신 쓰지 않는다.

## 확인한 방법

- PR #177(0134, Settings 서버 로그와 진단) run 44689901801 첫 시도 로그(`actions/runs/44689901801/attempts/1/logs`)에서 실패한 시험 이름과 실패 내용(`AssertionError: expected +0 to be 1`, `alert.waitFor()` 뒤 `count()`가 0)을 확인했다.
- PR #177 은 Run 상세 화면 코드(`apps/web/src/run-detail/`)를 바꾸지 않았다. 모든 화면에 걸리는 `apps/web/src/routes/__root.tsx`(브라우저 오류 기록)는 바꿨다. 코디네이터가 로컬에서 이 시험만 돌려 3번 모두 통과했다.

## 지운 시험과 잃은 확인 범위

- `e2e/src/run-detail.test.ts` '요청을 남기지 못하면 실패 문구가 role=alert 로 보인다'
  - CI: PR #177 run 44689901801 첫 시도에서 실패.
  - 잃은 확인: 실제 서버와 브라우저에서 이미 끝난 런의 취소를 확인하면 요청 실패 문구(`run.actionFailed`)가 `role="alert"` 하나로 보이는 것.
  - 남은 확인: `apps/web/src/run-detail/actions.test.ts` '취소의 ok:false는 이유가 담긴 오류로 throw하고 아무 key도 무효화하지 않는다'가 실패한 취소가 오류가 되는 것을 본다. 화면에 실패 문구를 `role="alert"`로 보이는 것은 이제 어떤 시험도 보지 않는다.
  - 이 시험만 쓰던 시드 런(`cancelFailsRun`, ACME-14)을 함께 지웠다.

## 완료 조건

- [x] 위 시험을 지우고 `.skip`·`.only`를 남기지 않는다.
- [x] 잃은 확인 범위와 남은 시험을 적는다.
- [x] 로컬에서 typecheck·lint·format 과 바뀐 시험 파일을 돌린다. 전체 시험은 CI `check`에 맡긴다.
