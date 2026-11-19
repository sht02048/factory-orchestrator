---
status: todo
blocked_by: [0119, 0120]
---

# 0123 TanStack Query PoC와 배선

## 목표

웹 앱에 TanStack Query를 들이는 배선만 넣고, 열린 상류 이슈 셋이 우리 설정에서 재현되지 않는지 확인한다. 화면은 옮기지 않는다. 스펙 [0003](../spec/0003-query-cache.md) 4.1·4.2절, ADR [0019](../adr/0019-query-cache-and-change-events.md), 운영자 결정 C2·C6·C13.

## 배경

- 지금 클라이언트 캐시는 라우터 로더 캐시 하나다(research [0016](../research/0016-web-data-loading.md)).
- 공식 결합 방식과 열린 이슈는 research [0015](../research/0015-tanstack-query.md) 1·7절에 있다.
- 0119(Settings 개편)와 0120(러너 쪽 멈춤 감지)은 머지됐다. 최신 `develop`에서 시작한다(C8).

## 할 일

1. **패키지.** `apps/web`에 `@tanstack/react-query`(`^5.108.0` 이상)와 `@tanstack/react-router-ssr-query`(`^1.167.3` 이상), 개발용 `@tanstack/react-query-devtools`를 더한다. 버전은 시작할 때 `npm view`로 다시 보고, 통합의 peer 범위(`@tanstack/react-query`·`@tanstack/query-core` `>=5.102.0`, `@tanstack/react-router` `>=1.170.33`)에 맞춘다. pnpm이 peer를 못 찾으면 `@tanstack/query-core`를 직접 의존성으로 더한다.
2. **요청별 `QueryClient`.** `apps/web/src/router.tsx`의 `getRouter()` 안에서 만들고 `context: { queryClient }`로 넘긴다. `setupRouterSsrQueryIntegration({ router, queryClient })`를 부른다.
3. **루트.** `createRootRoute`를 `createRootRouteWithContext<{ queryClient: QueryClient }>()`로 바꾼다. 루트의 `beforeLoad`·로더(시간대, 제목 표시줄, 온보딩 완료)와 `shouldReload: false`는 그대로다(C1).
4. **기본값(C6).** DB 데이터 `staleTime` 30초, `gcTime` 5분, 읽기 `retry` 1, 창 포커스·재연결 때 다시 읽기. Linear query의 5분은 그 query를 만드는 티켓이 준다. 값은 한 모듈에 이름 붙은 상수로 둔다. `defaultOptions.queries.retry`가 로더의 `queryClient.query`에도 먹는지 확인하고(그 API는 기본이 `retry: false`다, research 0015 4절), 안 먹으면 `queryOptions`에 적는다.
5. **devtools.** 개발 빌드에만 싣는다(C13). 프로덕션 묶음에 들어가지 않는 것을 빌드 결과로 확인한다.
6. **함께 쓰는 로더 도구.** 로더 변형(캐시가 있으면 기다리지 않고, 이번 이동을 위해 5초 안에 미리 읽은 것이 아니면 뒤에서 다시 읽기를 시작, 스펙 4.2)과 기본값 모듈을 화면 티켓이 가져다 쓰는 공용 코드로 둔다. 0125~0127이 따로 만들지 않게 한다.
7. **라우터 설정은 그대로.** 전역 `defaultPreloadStaleTime`은 5초로 둔다. 화면을 옮기는 티켓이 그 route에만 0을 준다(스펙 4.2). route 단위 옵션 이름(`preloadStaleTime` 등)과 `shouldReload` 함수와의 관계를 확인해 이 티켓에 적는다.
8. **로더 API 고르기.** 다시 들어간 화면을 캐시로 바로 그리는 로더 변형(`queryClient.query({ ...options, staleTime: "static" })` 또는 설치한 버전의 같은 API)을 설치한 버전에서 확인하고, 보기 query 하나(시험 전용 route나 시험 코드)로 0117 계약(hover 미리 읽기, 다시 들어가면 바로 그리고 뒤에서 새로 읽기)이 지켜지는지 본다. 다시 들어갈 때 이번 이동을 위해 5초 안에 미리 읽은 데이터면 다시 읽지 않고, 아니면 기다리지 않는 다시 읽기를 시작하는 기준(스펙 4.2)도 시험한다. 서버 렌더로 연 화면을 떠났다가 1~2초 안에 돌아오면 다시 읽어야 한다(0117 시험 `navigation.test.ts:122-131`과 같은 시나리오). 결과를 이 티켓에 적는다.
9. **열린 이슈 확인(C2).** 아래 셋을 확인한다. 하나라도 재현되면 우회하지 말고 멈춰 재현 방법과 함께 보고한다.
   - #7529: 프로덕션 빌드에서 `curl`로 문서를 받을 때 응답이 바로 끝난다(60초 "Serialization timeout"이 없다).
   - #8795: Safari(WebKit)에서 화면을 열고 이동해도 멈추지 않는다. 데스크톱 앱(Electron)에서도 한 번 본다.
   - #6347: 깨끗한 `pnpm install` 뒤 dev·build·`pnpm run bundle`이 통합의 peer를 찾는다.
10. 서버 함수에 `AbortSignal`을 넘기는 방법과 실패한 query가 서버 렌더 HTML에 오류 메시지를 싣는지 확인해 적는다(research 0015 5절). query 읽기가 throw할 때 지금 설정에서 어디에 보이는지(루트 `RootError`가 화면 전체를 대신하는지)도 적는다(스펙 0003 열린 질문 4).

## 완료 조건

- [ ] 위 1~7 배선과 공용 로더 도구. 화면 동작은 바뀌지 않는다.
- [ ] 8·9·10의 확인 결과를 이 티켓에 적었다. 재현된 이슈가 없다.
- [ ] 시험: 서버 렌더한 화면에서 hydration이 끝날 때까지 서버 함수 호출이 늘지 않는다(지금과 같은 수).
- [ ] 시험: 쿠키가 다른 동시 서버 렌더 요청이 서로의 값을 담지 않는다(요청별 `QueryClient`).
- [ ] 0117 브라우저 시험(`e2e/src/navigation.test.ts`)이 같은 뜻으로 통과한다(스펙 7절 5번).
- [ ] 클라이언트 묶음 크기 전·후(`e2e/src/measure-navigation.ts --client`)를 적었다.

## 머지 위험

의존성과 라우터 배선을 바꾸지만 저장 형식은 바꾸지 않아 two-way다. 닿는 곳은 web 전체다.
