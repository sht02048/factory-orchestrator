---
status: todo
blocked_by: [0037]
---

# Tracker 어댑터: tracker-linear

## 목표

core의 `Tracker` 인터페이스를 Linear GraphQL과 webhook으로 구현한다.

## 범위

- 이 티켓은 새 패키지 `packages/tracker-linear`만 만든다(Q56). `packages/core`는 고치지 않는다. 검증 결과에 따른 인터페이스 변경은 0037이 먼저 한다.
- webhook 검증: 원문 바이트의 HMAC-SHA256(`Linear-Signature`), 타임스탬프 1분, 본문 크기 제한. 검증에 실패한 요청은 이벤트가 되지 못한다(research 0002 B.2).
- 이벤트 파싱: 0011 결과에 맞춰 라벨 추가를 분류하고 `Linear-Delivery`를 중복 제거 키로 돌려준다.
- 조회: 티켓, 트래커 프로젝트, 팀 상태, 라벨이 붙은 티켓(폴링 보정, 페이지 크기는 0011 12번 결과).
- 갱신: 상태 변경("In Progress"), 결과 댓글(Q41·Q57).
- 인증 오류, rate limit, 네트워크 오류를 오류 종류로 돌려준다(research 0002 B.4).

## 완료 조건

- 0011의 webhook 픽스처로 서명 성공, 서명 틀림, 오래된 타임스탬프, 깨진 본문 테스트가 통과한다.
- GraphQL 응답 픽스처로 조회·갱신·오류 파싱 테스트가 통과한다.
- 테스트 Linear 워크스페이스에 붙여 트래커 프로젝트 목록 조회와 댓글 달기를 돌린 결과를 PR에 적었다(운영자 준비 필요, 0011과 같은 워크스페이스).
