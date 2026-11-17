---
status: todo
blocked_by: []
---

# 검증: Linear webhook과 API 계약

## 목표

Tracker 어댑터와 자동 할당을 짓기 전에, 스펙 10절의 Linear 사실을 테스트 워크스페이스에서 확인해 `docs/research/`에 남긴다.

## 범위

- 스펙 10절 10~14번:
  - 10: `Issue` update webhook의 `updatedFrom`에 `labelIds`·`stateId`가 담기는지, `data` 필드 목록
  - 11: 라벨 추가가 `Issue` update로 오는지, `IssueLabel` 이벤트로도 오는지
  - 12: 최대 페이지 크기(`first` 상한)
  - 13: 개인 API 키로 한 댓글·상태 변경이 Linear GitHub 연동의 자동 상태 전환과 충돌하는지
  - 14: `attachmentLinkGitHubPR`가 Linear GitHub 연동이 붙인 링크와 중복되는지
- 실제 webhook 본문과 서명 헤더 한 쌍을 가상 값으로 바꿔 서명 검증 테스트 픽스처로 남긴다(signing secret도 가상 값으로 다시 서명).
- 결과는 `docs/research/0005-linear-contract.md`에 쓴다.
- 운영자 준비가 필요하다: 테스트용 Linear 워크스페이스, 그 개인 API 키, webhook을 받을 공개 URL, Linear GitHub 연동을 켠 테스트 저장소(13·14번). 운영자 환경 값은 문서에 넣지 않는다(ADR 0005).

- 함께 도는 검증 티켓끼리 번호가 겹치지 않게 research 번호는 0005으로 정해 둔다. 픽스처는 `docs/research/fixtures/0005/`에 둔다.

## 완료 조건

- 다섯 항목마다 확인한 사실과 근거가 research 문서에 있고, 확인하지 못한 항목은 이유와 함께 남아 있다.
- 라벨 추가 webhook 본문 픽스처가 저장소에 있다.
