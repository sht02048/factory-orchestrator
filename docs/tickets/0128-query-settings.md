---
status: todo
blocked_by: [0127]
---

# 0128 Settings를 Query로

## 목표

Settings를 Query로 옮긴다. 저장 뒤에 Settings 전체와 트래커 세 읽기를 다시 하지 않고, 바꾼 key만 무효화하거나 새 값으로 바꾼다. 스펙 [0003](../spec/0003-query-cache.md) 4.3~4.5절, 운영자 결정 C3·C5·C7.

## 배경

- 저장이 성공하면 `useReloadOnSuccess`가 `router.invalidate()`를 불러 Settings 전체를 다시 읽는다. 트래커 프로젝트·상태·라벨 읽기(약 0.7초)도 다시 돈다(research [0016](../research/0016-web-data-loading.md) 5절).
- 0115의 직렬 저장(`settings/serial-save.ts`)과 초안 맞추기(`settings/synced-save.ts`)는 지킨다(C7).
- 0119가 Settings 로더와 화면을 바꾼 뒤다. 아래 key 모양은 0119 뒤 화면 구역에 맞춰 이 티켓이 정한다.
- Settings 저장은 셸의 Workspace 목록을 바꿀 수 있어 0127의 셸 query 뒤에 한다(C14).

## 할 일

1. **query 나누기.** DB 설정은 `["settings", ...]`(staleTime 30초), 트래커 프로젝트·상태·라벨은 `["tracker", "projects" | "states" | "labels", ...]`(staleTime 5분, C3). 라벨 key는 0127의 Tickets와 같은 것을 쓴다. 서버 함수도 그에 맞춰 나눈다.
2. **저장 뒤(C7).** `useReloadOnSuccess`의 `router.invalidate()`를 바꾼 key 무효화나, 서버가 새 값을 돌려주면 `setQueryData`로 바꾼다. 직렬 저장·초안 맞추기의 동작(마지막 값만 모아 차례로, 실패하면 되돌림, 저장된 값으로 다시 맞춤)은 그대로다.
3. **쓰기 오류(C5).** 쓰기 서버 함수는 지금처럼 `{ ok: false, reason }`을 돌려주고, mutation이 이유가 담긴 오류로 바꾼다. 화면 문구는 그대로다.
4. **트래커.** 라벨 만들기와 "Linear에서 다시 읽기"는 `["tracker"]`만 무효화한다. 다른 탭·기기에도 닿도록 0124의 `tracker` 변경 기록을 쓴다.
5. **변경 기록.** Settings 쓰기가 0124에서 `workspace`·`settings` 줄을 남기는지 0119 뒤 쓰는 곳 모두에 대해 확인한다. 빠진 곳은 이 티켓에서 더한다.
6. 셸과 함께 바뀌는 저장(Workspace 이름, 더하기·지우기)은 `["shell"]`도 무효화한다.
7. route에 `preloadStaleTime` 0을 주고 `router.invalidate()`를 지운다. Settings 화면 안의 러너 점검 폴링은 0127의 방식을 따른다.

## 완료 조건

- [ ] 시험: 서버 렌더한 화면에서 hydration이 끝날 때까지 이 화면의 서버 함수를 다시 부르지 않는다.
- [ ] 시험: mutation 하나 뒤 다시 읽는 서버 함수가 그 mutation이 바꾼 query뿐이다. 루트(`getTimeZone`, `getTitleBarHidden`)와 셸(`getShell`)은 다시 읽지 않는다.
- [ ] 시험: Mapping을 저장해도 트래커 프로젝트·상태·라벨을 다시 읽지 않는다(트래커 가짜 어댑터 호출 수).
- [ ] 0115의 직렬 저장·초안 맞추기 시험(`serial-save.test.ts`, `mapping-draft.test.ts`)이 그대로 통과한다.
- [ ] 시험: 다른 탭에서 설정을 저장하면 열린 Settings가 3초 안에 바뀐다.
- [ ] 시험: SSE가 끊기면 열린 Settings가 30초마다 다시 읽는다(가짜 시계).
- [ ] 0117 브라우저 시험이 그대로 통과한다.

## 머지 위험

저장 형식은 바꾸지 않아 two-way다. 닿는 곳은 web(Settings)과 `packages/app`의 Settings 로더다.
