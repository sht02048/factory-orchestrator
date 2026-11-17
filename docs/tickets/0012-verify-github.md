---
status: todo
blocked_by: []
---

# 검증: GitHub PR 조회 계약

## 목표

GitHub 어댑터를 짓기 전에, 스펙 10절의 GitHub 사실을 실제 토큰으로 확인해 `docs/research/`에 남긴다.

## 범위

- 스펙 10절 15, 17, 18, 20번:
  - 15: fine-grained PAT로 GraphQL `statusCheckRollup`이 check run 결과까지 돌려주는지
  - 17: 에이전트가 브랜치를 바꾸거나 다른 브랜치로 PR을 연 경우. Q40의 티켓 키 보조 검색이 충분한지
  - 18: GitHub GraphQL 요청에 ETag/304가 적용되는지
  - 20: PR 제목·본문의 티켓 키로 PR을 찾는 쿼리(검색 API 등)와 그 rate limit
- 결과는 `docs/research/NNNN-github-contract.md`에 쓴다. 응답은 가상 값으로 바꿔 어댑터 테스트 픽스처로 남긴다.
- 운영자 준비가 필요하다: 읽기 권한(Metadata, Pull requests, Commit statuses)만 준 fine-grained PAT와, check run이 도는 테스트 저장소. 운영자 환경 값은 문서에 넣지 않는다(ADR 0005).

## 완료 조건

- 네 항목마다 확인한 사실과 근거가 research 문서에 있고, 확인하지 못한 항목은 이유와 함께 남아 있다.
- 20번의 답으로 GitHub 어댑터가 티켓 키로 PR을 찾을 쿼리가 정해져 있다.
