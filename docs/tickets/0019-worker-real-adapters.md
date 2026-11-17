---
status: todo
blocked_by: [0013, 0014, 0015, 0018]
---

# worker에 실제 어댑터 연결

## 목표

worker가 DB의 설정으로 실제 어댑터(runner-orca, tracker-linear, codehost-github)를 만들어 돈다.

## 범위

- 이 티켓은 `apps/worker`만 고친다.
- DB에서 러너 설정, Tracker Connection, GitHub 토큰(복호화)을 읽어 어댑터를 만든다. 설정이 바뀌면 다시 만든다.
- 어댑터 오류 종류(인증, rate limit, ssh 실패)에 맞게 다음 폴링을 늦추거나 런을 이어서 본다. rate limit 예산은 0012 18번 결과를 따른다.
- worker 시작 때 마이그레이션을 실행한다(ADR 0005).

## 완료 조건

- 테스트 러너·테스트 Linear 워크스페이스·테스트 토큰으로 할당 진입점에서 만든 런 하나가 Ended까지 가고 두 축(에이전트 결과, PR 상태)이 DB에 써진 것을 PR에 적었다(운영자 준비 필요, 0009~0012의 테스트 환경).
- 설정이 바뀌면 어댑터를 다시 만든다는 테스트가 통과한다.
