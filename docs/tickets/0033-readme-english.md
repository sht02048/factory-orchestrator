---
status: todo
blocked_by: []
---

# README 영어화

## 목표

README를 AGENTS.md와 ADR 0005의 문서 언어 규칙(README와 사용자 문서는 영어)에 맞춘다.

## 범위

- 이 티켓은 루트 `README.md`만 고친다.
- 지금 한국어 README를 영어로 옮기고, 구조 표에 Q56의 패키지(`packages/tracker-linear`, `packages/runner-orca`, `packages/codehost-github`, `apps/cli`)를 계획으로 더한다.
- 셀프호스팅 절은 `.env`에 부팅 최소값만 둔다는 것(ADR 0005, Q58)에 맞춘다. 설치 절차는 0029가 채운다.
- 용어는 GLOSSARY의 영어 낱말을 쓴다.

## 완료 조건

- README에 한국어 문장이 없다.
- README가 말하는 명령과 경로가 저장소에 있는 것과 같다. 계획으로 적은 패키지는 계획이라고 표시돼 있다.
