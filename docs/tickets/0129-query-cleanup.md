---
status: todo
blocked_by: [0122, 0125, 0126, 0127, 0128]
---

# 0129 Query 이행 정리와 다시 재기

## 목표

`_app`의 데이터 화면을 모두 옮긴 뒤 라우터 쪽 남은 캐시 설정과 `router.invalidate()`를 지우고, 화면 이동을 다시 재어 전·후를 남긴다. 스펙 [0003](../spec/0003-query-cache.md) 1·6·7절, 운영자 결정 C6·C13.

## 할 일

1. `apps/web/src`에 남은 `router.invalidate()`를 지운다. 루트(`routes/__root.tsx`), 온보딩(`routes/onboarding.tsx`와 그것이 넘기는 저장 뒤 동작), 온보딩이 넘기는 러너 설정 동작의 것은 남긴다(C1). Runners가 쓰는 러너 설정 동작은 0127이 key 무효화로 바꿨다. 루트 `TimeZoneSync`의 필터는 루트만 남긴다(화면은 시간대가 든 key로 새로 읽는다).
2. 라우터 전역 `defaultPreloadStaleTime`을 0으로 바꾸고(C6), 화면마다 준 `preloadStaleTime`과 `PRELOAD_FRESH_MS`를 지운다. 의미가 없어진 `shouldReload` 설정을 지운다. 전역 0이 라우터 로더로 남는 온보딩·러너 설정 route의 미리 읽기를 바꾸지 않는지(포인터를 올릴 때마다 서버 함수를 더 부르지 않는지) 확인한다.
3. ADR [0019](../adr/0019-query-cache-and-change-events.md)와 스펙 0003을 실제 결과에 맞춰 고친다(정한 로더 API, key 모양, 탭 여러 개 결정).
4. 0117 측정(`e2e/src/measure-navigation.ts`)과 0122의 원격 지연 측정을 돌려 전·후 표를 이 티켓에 남긴다. "전"은 0125~0127 가운데 처음 머지된 것 바로 앞의 `develop` 커밋이다(0123·0124는 화면을 옮기지 않는다). 그 커밋을 빌드해 띄우고 이 티켓 head의 측정 스크립트로 잰다. "후"는 이 티켓의 head다.
5. 남은 폴링을 정리한다. 0124의 30초 대비와 query `refetchInterval` 말고는 화면 폴링이 없어야 한다(온보딩·러너 설정 흐름의 것은 남긴다).

## 완료 조건

- [ ] `rg "router.invalidate" apps/web/src`에 루트·온보딩·러너 설정 흐름의 것만 남았다.
- [ ] 스펙 0003 7절의 다섯 시험이 모든 `_app` 화면에서 통과한다.
- [ ] 0117 브라우저 시험이 그대로 통과한다.
- [ ] 전·후 측정 표(같은 기기, 원격 지연)를 이 티켓에 적었다.
- [ ] ADR 0019와 스펙 0003을 고쳤다.

## 머지 위험

저장 형식은 바꾸지 않아 two-way다. 닿는 곳은 web 전체다.
