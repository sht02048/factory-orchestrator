---
status: todo
blocked_by: [0037]
---

# GitHub 어댑터: codehost-github

## 목표

core의 `CodeHost` 인터페이스를 GitHub GraphQL로 구현한다.

## 범위

- 이 티켓은 새 패키지 `packages/codehost-github`만 만든다(Q56). `packages/core`는 고치지 않는다. 검증 결과에 따른 인터페이스 변경은 0037이 먼저 한다.
- 브랜치로 PR 찾기(`pullRequests(headRefName:)`, 최신순, `isCrossRepository`·`headRepository`·`baseRefName` 확인), 티켓 키로 PR 찾기(0012 20번 결과), PR 상태와 CI 상태(research 0002 C.2·C.4). CI 상태는 선택이다(Q79). Actions 읽기 권한이 있으면 `actions/runs?head_sha=`로 읽고, 권한이 없어 읽지 못하면 "볼 수 없음"으로 돌려준다(research 0006 15절).
- PR을 남긴 런(요약 계산 함수의 워크트리 처리가 PR이 병합되거나 닫힐 때까지 남김인 런)의 이후 PR 상태(병합됨 / 닫힘)를 다시 조회할 수 있게 PR 번호로 조회한다(Q54·Q69).
- rate limit 조회와 오류 종류(인증, rate limit, 네트워크).
- 토큰 확인: 온보딩·Settings에서 쓸 연결 확인(research 0002 C.4). CI를 읽을 권한은 저장소마다 달라 토큰 확인에서 정하지 않고, CI를 읽다 권한 때문에 실패하면 "볼 수 없음"으로 돌려준다(Q79).

## 완료 조건

- 0012의 응답 픽스처와, 이 티켓이 테스트 토큰으로 새로 받은 응답(PR 없음, 같은 브랜치에 PR 여럿, 인증 오류, rate limit)을 가상 값으로 바꾼 픽스처로 PR 찾기(브랜치, 티켓 키, 없음, 여럿), 상태, CI, 오류 파싱 테스트가 통과한다. Actions 읽기 권한이 없는 응답에서 CI 상태가 "볼 수 없음"이 되고 PR 상태는 그대로 정해진다는 테스트가 통과한다.
- 테스트 토큰으로 테스트 저장소의 PR 하나를 조회한 결과를 PR에 적었다(운영자 준비 필요, 0012와 같은 토큰).
