---
status: todo
blocked_by: []
---

# 0062 남은 "손댈 일" 문구와 Home 낱말 정리

## 목표

0059에서 "손댈 일"을 To do로, Home을 Dashboard로 바꿨다. 다른 화면과 문서에 남은 옛 낱말을 맞춘다.

## 배경

0060은 Dashboard 화면만 바꿨다. 다른 화면의 메시지와 시험, AGENTS.md에 옛 낱말이 남아 있다(2026-11-18 기준).

- 메시지: `apps/web/messages/ko/` 의 `run.json`, `runs.json`, `tickets.json`, `ds.json`
- 시험: `apps/web/src/status.test.tsx`, `home/load.test.ts`, `runs/runs-screen.test.tsx`, `runs/load.test.ts`, `stats/stats-screen.test.tsx`
- AGENTS.md "UI" 절의 "Home·Run 상세·Runners·온보딩"

## 범위

- 위 메시지의 "손댈 일"을 GLOSSARY의 To do와 화면 문맥에 맞는 해요체 문장으로 바꾼다. 이름 자리는 영어 용어(To do), 문장 안에서는 말하듯 쓴다(예: "처리할 일").
- 시험의 이름·단언 문구를 맞춘다. 시험이 확인하는 동작은 바꾸지 않는다.
- AGENTS.md의 Home을 Dashboard로 바꾼다.
- 지난 티켓·research 기록은 그 시점 기록이라 고치지 않는다.

## 완료 조건

- `rg "손댈 일" apps packages AGENTS.md README.md` 결과가 없다.
- 바뀐 문구가 메시지 파일에만 있고, 전체 시험이 통과한다.
