---
status: todo
blocked_by: [0004, 0012]
---

# GitHub 어댑터: codehost-github

## 목표

core의 `CodeHost` 인터페이스를 GitHub GraphQL로 구현한다.

## 범위

- 이 티켓은 새 패키지 `packages/codehost-github`만 만든다(Q56). 검증 결과로 core 인터페이스를 바꿔야 하면 그 변경만 `packages/core`에 더하고 PR에 적는다.
- 브랜치로 PR 찾기(`pullRequests(headRefName:)`, 최신순, `isCrossRepository`·`headRepository`·`baseRefName` 확인), 티켓 키로 PR 찾기(0012 20번 결과), PR 상태와 CI 상태(research 0002 C.2·C.4).
- Human Check 뒤 PR 상태(병합됨 / 닫힘)를 다시 조회할 수 있게 PR 번호로 조회한다(Q54).
- rate limit 조회와 오류 종류(인증, rate limit, 네트워크).
- 토큰 확인: 온보딩·Settings에서 쓸 권한 확인(research 0002 C.4).

## 완료 조건

- 0012의 응답 픽스처로 PR 찾기(브랜치, 티켓 키, 없음, 여럿), 상태, CI, 오류 파싱 테스트가 통과한다.
- 테스트 토큰으로 테스트 저장소의 PR 하나를 조회한 결과를 PR에 적었다(운영자 준비 필요, 0012와 같은 토큰).
