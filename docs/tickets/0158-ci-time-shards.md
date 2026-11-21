---
status: done
blocked_by: []
---

# 0158 CI 시간 기준 나누기

## 목표

CI `browser` 잡의 shard 4개가 파일 경로 hash 로 나뉘어 시간이 기운다([0143](0143-ci-e2e-shards.md)). 운영자 결정(2026-11-21, F9)으로 파일별 시간을 저장소에 두고 Vitest sequencer 가 4개 작업에 고르게 나눈다.

## 할 일

- [x] 파일별 시간 JSON(`scripts/browser-test-times.json`)을 저장소에 둔다.
- [x] Vitest sequencer 가 이 시간으로 shard 를 나눈다. 시간이 없는 새 파일은 아는 파일의 평균으로 친다.
- [x] 성공한 CI 실행의 로그에서 시간 파일을 다시 만드는 명령(`pnpm run update:browser-times <run-id>...`)을 둔다. 손으로 가끔 돌린다.
- [x] README·AGENTS.md 의 CI 설명을 맞춘다.

## 완료 조건

- 시험: 모든 파일이 정확히 한 작업에 들어가고, 입력 순서가 달라도 나뉨이 같고, 새 파일과 잘못된 시간 파일을 다룬다.
- PR 의 CI 에서 가장 긴 작업이 가장 짧은 작업의 1.2배 안이다. PR 본문에 작업별 시간과 비를 적는다.
- 시험 코드·앱 코드는 바꾸지 않는다. 화면 변경 없음. DB 변경 없음. two-way.
