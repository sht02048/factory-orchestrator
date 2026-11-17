---
status: todo
blocked_by: [0008, 0019, 0020, 0021, 0022, 0023, 0024, 0026, 0027, 0028, 0032, 0033]
---

# npm 패키지 빌드와 Changesets

## 목표

npm 패키지 하나로 설치해 CLI가 도는 배포물을 만든다. 아직 공개하지 않는다.

## 범위

- worker, CLI, 공유 패키지를 JS로 빌드한다. Node는 `node_modules` 안의 `.ts`를 실행하지 않는다(research 0001 「남은 위험」). 번들러는 이 티켓에서 정한다.
- web `dist`와 함께 npm 패키지 하나로 묶는다(ADR 0005). 패키지 이름은 지금 이름(`factory-orchestrator`, 임시)을 쓴다.
- Changesets 설정과 0.1.0 changeset(ADR 0005).
- README에 설치·업그레이드 절을 영어로 쓴다(0033 뒤).
- 모든 패키지의 `package.json`을 고치므로 기능 티켓이 끝난 뒤에 한다.

## 완료 조건

- `npm pack`으로 만든 파일을 새 임시 폴더에 설치해 CLI `init`·`start`가 돌고 web이 응답한다는 시험이 CI에서 통과한다.
- `changeset status`가 0.1.0을 보여 준다.
