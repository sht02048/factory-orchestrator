---
status: done
blocked_by: [0008, 0032, 0036]
---

# 규칙 문서를 색 검사와 CI 단계에 맞추기

## 목표

0003으로 색 리터럴 검사와 웹 build 단계가 생겼다. 사람과 에이전트가 읽는 규칙 문서를 지금의 검사에 맞춘다.

## 범위

- 이 티켓은 `CODING_STANDARDS.md`와 `AGENTS.md`만 고친다. 색 검사 빈틈(0036)이 닫히기 전에 규칙을 지우지 않고, CI·훅을 고치는 0008·0032가 끝난 뒤의 목록에 맞추려고 그 뒤에 한다.
- `CODING_STANDARDS.md`의 「색 값은 디자인 토큰으로 쓴다」 규칙을 지운다. 이제 `scripts/check-color-literals.ts`가 pre-commit과 CI에서 같은 것을 막는다(같은 문서의 규칙을 더하는 조건: lint 등 도구가 잡지 못하는 것만 둔다).
- `AGENTS.md`의 훅·CI 목록에 색 검사(`pnpm run check:colors`)와 웹 build 단계를 더한다. 실제 순서는 `lefthook.yml`과 `.github/workflows/ci.yml`을 따른다.

## 완료 조건

- `CODING_STANDARDS.md`에 색 값 규칙이 없다.
- `AGENTS.md`의 훅·CI 목록이 `lefthook.yml`·`ci.yml`의 단계와 같다.
