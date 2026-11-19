---
status: todo
blocked_by: [0124]
---

# 0126 Dashboard·Stats를 Query로

## 목표

Dashboard와 Stats를 Query로 옮기고, Dashboard의 15초 폴링을 변경 기록으로 바꾼다. 스펙 [0003](../spec/0003-query-cache.md) 4.3~4.5절, 운영자 결정 C4·C5·C6·C12.

## 배경

- Dashboard는 `home/refresh.ts`로 탭이 보일 때 15초마다 다시 읽는다. 결과는 라우터 캐시 밖 로컬 state에 담겨, 다른 화면에 갔다 오면 로더가 또 읽고 셸은 갱신하지 않는다(research [0016](../research/0016-web-data-loading.md) 4·9절).
- Stats는 머무는 동안 다시 읽지 않는다. 둘 다 시간대 쿠키로 결과가 바뀐다.

## 할 일

1. **query.** `["dashboard", ws, timeZone]`(`getHomePage`), `["stats", ws, days, timeZone]`(`getStatsPage`). 로더와 컴포넌트가 같은 `queryOptions`를 쓴다. 두 route에 `preloadStaleTime` 0을 준다.
2. **15초 폴링 지우기.** `home/refresh.ts`와 `_app/index.tsx`의 로컬 state(`polled`)를 지우고 Query와 변경 기록(0124)으로 갱신한다.
3. **멈추기·재개 처리 중.** 2초 다시 읽기를 `refetchInterval`로 옮긴다.
4. **mutation(C5).** Dashboard의 답하기, 거절, 멈추기와 재개. 0124가 만든 오류 타입과 변환 함수를 쓴다. 서버 함수는 바꾸지 않는다. 멈추기·재개의 `ok: false`는 지금처럼 "상태가 바뀜" 결과다(스펙 4.4). 성공하면 `["dashboard"]`와 그 런의 `["runs", ...]` key만 무효화한다.
5. **시간대.** key에 넣어, `TimeZoneSync`의 `/_app/stats`·`/_app/` 필터 없이도 새로 읽게 한다. 루트 필터 정리는 0129가 한다.
6. 두 route에서 `router.invalidate()`를 지운다. 아직 옮기지 않은 화면도 바꾸는 쓰기는 옮기는 동안 그 route id만 고른 `router.invalidate({ filter })`를 함께 부른다(스펙 6절 3번).

## 완료 조건

- [ ] 시험: 서버 렌더한 화면에서 hydration이 끝날 때까지 이 화면의 서버 함수를 다시 부르지 않는다.
- [ ] 시험: mutation 하나 뒤 다시 읽는 서버 함수가 그 mutation이 바꾼 query뿐이다. 루트(`getTimeZone`, `getTitleBarHidden`)와 셸(`getShell`)은 다시 읽지 않는다(스펙 7절 2번의 예외 제외).
- [ ] 시험: worker와 같은 함수로 런 상태를 바꾸면 열린 Dashboard가 3초 안에 바뀐다(15초 폴링 없이).
- [ ] 시험: 러너가 Offline이 되면(`runner` 바뀜) Dashboard 러너 카드가 바뀐다.
- [ ] 시험: SSE가 끊기면 열린 Dashboard가 30초마다 다시 읽는다(가짜 시계).
- [ ] 시험: 시간대 쿠키가 바뀌면 Dashboard와 Stats가 새 시간대로 다시 읽는다.
- [ ] `home/refresh.ts`와 그 시험을 지웠다.
- [ ] 0117 브라우저 시험이 그대로 통과한다.

## 머지 위험

저장 형식은 바꾸지 않아 two-way다. 닿는 곳은 web(Dashboard, Stats)이다.
