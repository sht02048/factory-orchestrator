# TanStack Query 도입 조사 (TanStack Start + Router 위)

조사일: 2026-11-19. 제품 코드는 바꾸지 않았다. 우리 앱의 지금 데이터 읽기는 research [0016](0016-web-data-loading.md)에, 이 조사로 정한 것은 ADR [0019](../adr/0019-query-cache-and-change-events.md)와 스펙 [0003](../spec/0003-query-cache.md)에 있다. 문서는 모두 tanstack.com `latest` 판을 이날 읽었다. `latest` 문서는 날짜가 없어서 읽은 날을 기준으로 삼는다. npm 버전과 날짜는 `npm view`로 확인했다.

대상 앱: `@tanstack/react-start` 1.169.5, `@tanstack/react-router` 1.170.46(→ `@tanstack/router-core` 1.171.39), React 19.3, Vite 8, SSR 켬. 지금은 route `loader`가 `createServerFn` 서버 함수를 부르고, mutation 뒤에 `router.invalidate()`를 부른다. `defaultPreload: "intent"`, `defaultPreloadStaleTime: 5000`, root와 `_app`은 `shouldReload: false`, runners는 `shouldReload: reloadOnEnter`다. 운영자가 다른 기기에서 사설망 너머로(왕복 20~200ms) 쓰는 일이 많고, 서버에는 알림 사건을 보내는 SSE 끝점(`/api/notification-events/stream`)이 이미 있다.

이 문서의 **[추론]** 가운데 몇은 운영자가 다르게 정했다(2026-11-19, 스펙 0003). 3.4절의 "알림 사건 SSE를 받아 무효화하기"는 따로 둔 새 통로 `/api/change-events/stream`(C10)으로, 8절의 이행 순서는 C14로 바뀌었다. 4절의 기본값 권장과 다 옮긴 뒤 전역 `defaultPreloadStaleTime` 0은 C6이 정했다.

표기: **[확인]** 1차 출처에서 직접 읽었다. **[추론]** 출처를 바탕으로 이 문서가 낸 판단이다. **[미확인]** 확인하지 못했다.

## 0. 버전 현황 (npm, 2026-11-19)

| 패키지                             | 최신                 | 비고                                            |
| ---------------------------------- | -------------------- | ----------------------------------------------- |
| `@tanstack/react-query`            | 5.108.0 (2026-11-17) | v5가 현재 메이저다                              |
| `@tanstack/query-core`             | 5.108.0              |                                                 |
| `@tanstack/react-query-devtools`   | 5.108.0              |                                                 |
| `@tanstack/react-router-ssr-query` | 1.167.3 (2026-09-16) | 의존: `@tanstack/router-ssr-query-core` 1.169.3 |
| `@tanstack/react-router`           | 1.170.46             | 우리 버전과 같다                                |
| `@tanstack/react-start`            | 1.169.7 (2026-11-19) | 우리는 1.169.5                                  |

`@tanstack/react-router-ssr-query@1.167.3`의 peerDependencies는 다음과 같다 **[확인]**. 우리 버전 조합은 모두 맞는다.

- `@tanstack/react-query` `>=5.102.0`, `@tanstack/query-core` `>=5.102.0`
- `@tanstack/react-router` `>=1.170.33`
- `react`, `react-dom` `>=18`

공식 예제 `examples/react/start-basic-react-query/package.json`은 `@tanstack/react-query ^5.102.0`, `@tanstack/react-router ^1.170.46`, `@tanstack/react-router-ssr-query ^1.167.3`, `@tanstack/react-start ^1.169.7`, `vite ^8.0.14`, React 19를 쓴다 **[확인]**. 우리 스택과 거의 같다.

5.102.0(2026-08-22)에서 `queryClient.query`와 `queryClient.infiniteQuery`가 들어왔고, 예전 명령형 메서드(`ensureQueryData`, `prefetchQuery`, `fetchQuery`와 infinite 변형)가 deprecated 됐다(query-core 5.102.0 릴리스 노트, PR #10658) **[확인]**. v6에서 지운다고 적혀 있다 **[확인]**. ssr-query 패키지의 peer 하한이 5.102.0인 이유가 이것으로 보인다 **[추론]**.

설치 대상: `@tanstack/react-query@^5.108.0`, `@tanstack/react-router-ssr-query@^1.167.3`, 개발용 `@tanstack/react-query-devtools@^5.108.0`. `@tanstack/query-core`는 strict 링커에서 peer 해석 문제가 보고됐다(아래 7절). 그래서 직접 의존성으로 넣는 것도 검토한다.

## 1. 공식 권장 결합 방식 (Router/Start 로더 + SSR)

### 1.1 라우터 생성

Start 가이드와 공식 예제 `src/router.tsx`가 같은 모양을 보여 준다 **[확인]**.

```tsx
export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000 } },
  });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
  });
  setupRouterSsrQueryIntegration({ router, queryClient });
  return router;
}
```

- `QueryClient`는 `getRouter()` 안에서 만든다. Start는 SSR 요청마다 라우터를 새로 만든다. 모듈 범위 client는 한 사용자의 캐시를 다른 사용자의 HTML에 섞을 수 있다(Start 가이드 1절) **[확인]**.
- root는 `createRootRouteWithContext<{ queryClient: QueryClient }>()`로 선언해 자식 로더가 `context.queryClient`를 쓰게 한다 **[확인]**. 우리 root는 지금 `createRootRoute`라서 바꿔야 한다 **[추론]**.
- 통합이 provider(`QueryClientProvider`로 감싸기), dehydrate/hydrate, 스트리밍을 맡는다. "두 번째 QueryClient를 만들거나 같은 캐시를 직접 dehydrate하지 말라"고 적혀 있다 **[확인]**. provider를 직접 두려면 `wrapQueryClient: false`를 쓴다 **[확인]**.
- 30초 `staleTime`은 "예시 값이지 보편 기본값이 아니다"라고 적혀 있다 **[확인]**.

### 1.2 `setupRouterSsrQueryIntegration` 옵션 (Router "TanStack Query Integration" 문서)

| 옵션               | 기본 | 뜻                                                                       |
| ------------------ | ---- | ------------------------------------------------------------------------ |
| `wrapQueryClient`  | true | 라우터를 `QueryClientProvider`로 감싼다                                  |
| `handleRedirects`  | true | query나 mutation이 던진 `redirect()`를 잡아 `router.navigate`한다        |
| `dehydrateOptions` |      | `shouldDehydrateQuery`(예: `meta.ssr === false`면 뺀다), `serializeData` |
| `hydrateOptions`   |      | `defaultOptions.queries.gcTime`, `deserializeData`                       |

### 1.3 서버와 클라이언트 동작 (패키지 소스 `router-ssr-query-core/src/index.ts`)

**[확인]** 소스에서 직접 읽었다.

- 서버
  - `router.options.dehydrate`를 감싼다. dehydrate 시점에 캐시에 있는 query를 `initial`로 보낸다. 기본 `shouldDehydrateQuery`가 `() => true`라서 모든 query가 대상이다.
  - 그 뒤에 promise가 생긴 query는 query cache 구독으로 모아 `ReadableStream`으로 흘려 보낸다. render가 끝나면(`onRenderFinished`) 스트림을 닫는다.
  - SSR cleanup에서 `queryClient.clear()`를 부른다. 서버의 요청별 캐시와 진행 중인 작업, gc 타이머를 지운다.
- 클라이언트: `router.options.hydrate`를 감싼다. `initial`을 hydrate하고, 스트림을 읽으며 들어오는 대로 hydrate한다.
- `handleRedirects`: QueryCache와 MutationCache의 `onError`를 감싸 `isRedirect`면 navigate한다. 기존 `onError`는 그대로 이어 부른다.

### 1.4 로더와 컴포넌트

Start 가이드는 다음 패턴을 쓴다 **[확인]**.

```tsx
const readerNameOptions = queryOptions({
  queryKey: ['reader-name'],
  queryFn: () => getReaderName(), // createServerFn
})
// route
loader: async ({ context }) => { await context.queryClient.query(readerNameOptions) },
component: () => { const { data } = useSuspenseQuery(readerNameOptions) /* ... */ },
```

- 로더와 컴포넌트가 같은 `queryOptions` 객체를 쓴다. 로더가 요청 캐시를 채우고, 컴포넌트가 읽고, 통합이 브라우저로 넘긴다 **[확인]**.
- 매개변수가 있는 자원은 key에 식별자를 넣는다(`['post', postId]`). search param이 결과를 바꾸면 검증한 값을 `loaderDeps`와 query key 양쪽에 넣는다 **[확인]**.
- 핵심 데이터(본문, `head` title, 권한, redirect, 존재 여부)는 await한다. 부수 데이터는 await하지 않고 시작만 해서 Suspense 경계 안에서 스트리밍한다. 이때 `.catch(noop)`으로 처리되지 않은 rejection을 막는다 **[확인]**.
- `useQuery`는 서버에서 돌지 않는다. 로더에서 미리 받지 않은 `useQuery`는 hydration 뒤에 클라이언트에서 가져온다. SSR HTML에 넣으려면 `useSuspenseQuery`나 로더 prefetch를 쓴다(Router 통합 문서) **[확인]**.

**문서 사이 불일치** **[확인]**

- Router 통합 문서와 External Data Loading 문서: 블로킹 로더에 `queryClient.query({ ...opts, staleTime: 'static' })`를 쓴다. 이는 `ensureQueryData`의 대체로, 캐시에 있으면 신선도와 상관없이 바로 돌려준다.
- Start 가이드: `queryClient.query(opts)`를 쓴다. 이는 `fetchQuery`의 대체로, staleTime이 지났으면 다시 가져온다.
- 공식 예제 `posts.$postId.tsx`: 아직 deprecated된 `ensureQueryData`를 쓴다. `deferred.tsx`는 `prefetchQuery`를 쓴다.

**[추론]** 둘의 차이는 다시 들어간 화면에서 로더가 기다리느냐다.

- `'static'` 변형은 캐시가 있으면 즉시 넘어가고, 낡은 데이터는 컴포넌트의 `useSuspenseQuery` observer가 mount 시 배경에서 새로 받는다(stale-while-revalidate).
- `query(opts)` 변형은 stale이면 로더가 응답을 기다린다.

원격 RTT가 큰 우리 환경에서는 `'static'` 변형이 탐색 체감에 유리하다. 단 `router.invalidate()` 뒤에도 로더가 캐시를 그대로 돌려주므로, 새 데이터가 필요하면 query 쪽을 invalidate해야 한다(2절).

## 2. 라우터 캐시와의 관계

- **`defaultPreloadStaleTime: 0`**: Router Data Loading 문서는 "TanStack Query 같은 외부 캐시를 기본 설정으로 쓸 때 바꿀 것은 `defaultPreloadStaleTime`을 0으로 두는 것뿐"이라고 적는다 **[확인]**.
  - 0이면 preload로 얻은 loader 결과가 곧바로 stale이 된다. 그래서 다음 preload나 navigation마다 로더가 다시 돈다. 로더가 Query 캐시를 보므로 실제 fetch 여부는 Query의 `staleTime`이 정한다 **[확인]**.
  - Start 예제와 가이드도 0을 쓴다 **[확인]**.
  - 우리는 지금 5000이다. Query 도입 범위만큼은 0으로 바꾸고 신선도를 Query `staleTime`으로 넘기는 것이 공식 권장이다. 라우터 기본 `defaultPreloadStaleTime`은 30초다 **[확인]**.
- **preload on intent**: 0으로 두면 hover마다 로더가 다시 돈다. 로더가 Query 캐시에 맞으면 네트워크 요청이 없다 **[추론]**. 로더가 `'static'` 변형이면 캐시가 있는 한 요청하지 않는다. `query(opts)` 변형이면 Query `staleTime`이 지났을 때만 요청한다.
- **`shouldReload: false`**: 라우터 문서의 의미는 진입 시나 deps가 바뀔 때만 로더를 돌리는 것이다 **[확인]**.
  - Query를 쓰는 route에서는 신선도를 Query가 맡는다. 로더는 "첫 진입 때 캐시를 데워 두는 일"만 하므로 `shouldReload: false`가 큰 의미가 없어진다 **[추론]**.
  - Query로 옮기지 않은 root·`_app` 로더(시간대, 온보딩)는 지금처럼 둬도 된다 **[추론]**.
  - `shouldReload` 함수와 `defaultPreloadStaleTime: 0`이 어떻게 함께 동작하는지(우리 runners의 `reloadOnEnter`)를 다룬 공식 설명은 찾지 못했다 **[미확인]**.
- **`router.invalidate()`**
  - matching된 committed, 캐시된, 진행 중인 loader 결과를 무효로 하고, 활성 route는 다시 로드한다. 기본은 배경 재검증이고 `sync: true`면 기다린다(Data Loading 문서) **[확인]**.
  - Start 가이드는 이렇게 나눈다: "`invalidateQueries`는 Query 데이터를 새로 하고, `router.invalidate()`는 Router loader 데이터와 route context를 새로 한다. mutation이 둘 다 바꿀 때만 둘 다 부른다(예: 로그인)" **[확인]**.
  - **주의 [추론]**: Query로 옮긴 route에서 `router.invalidate()`만 부르면 로더가 다시 돌아도 `'static'` 변형은 캐시를 그대로 돌려준다. `query(opts)` 변형도 staleTime 안이면 캐시를 돌려준다. 그래서 화면이 바뀌지 않는다. 옮긴 route의 mutation은 반드시 `invalidateQueries`로 바꿔야 한다.
- External Data Loading 문서: suspense와 Query를 함께 쓸 때 `errorComponent`에서 `useQueryErrorResetBoundary().reset()`을 effect로 부르라고 한다. 재시도 버튼은 `router.invalidate()`로 로더와 라우터 에러 경계를 다시 돌린다 **[확인]**.

## 3. 무효화 패턴

### 3.1 queryKey 설계

- key와 queryFn을 `queryOptions`로 한곳에 묶는다(Start 가이드 2절) **[확인]**.
- 매개변수와 search 결과를 key에 넣는다. 비밀값은 key에 넣지 않는다 **[확인]**.
- TkDodo 글의 계층 key는 `['posts', 'list']`, `['posts', 'detail', 5]` 모양이다. 접두사 `['posts']`로 관련된 것을 한꺼번에 invalidate할 수 있다 **[확인]**.
- 우리에게 맞는 모양은 `['runs', 'list', filters]`, `['runs', 'detail', runId]`, `['runners', ...]`, `['stats', range, timeZone]`, `['settings', ...]` 같은 엔터티 접두사 계층이다 **[추론]**. 시간대가 결과를 바꾸는 stats와 dashboard는 시간대를 key에 넣어야 한다. 그러면 지금 `TimeZoneSync`가 하는 `router.invalidate({ filter })`를 key 변경으로 대신할 수 있다 **[추론]**.

### 3.2 서버 함수 mutation 뒤 invalidate

Start 가이드 5절 **[확인]**:

```tsx
const save = useServerFn(saveReaderName);
const mutation = useMutation({
  mutationFn: (name: string) => save({ data: name }),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: readerNameOptions.queryKey }),
});
```

- invalidation promise를 돌려준다. 그래야 활성 query가 refetch를 마칠 때까지 mutation이 pending으로 남는다 **[확인]**.
- mutation이 바뀐 자원을 통째로 돌려주면 `setQueryData`로 바로 반영할 수 있다 **[확인]**.
- `invalidateQueries`의 기본 동작 **[확인]**
  - 맞는 query를 invalidated로 표시하고 `refetchType`(기본 `'active'`)만 다시 가져온다.
  - `cancelRefetch` 기본 true로 진행 중인 fetch를 취소하고 새로 시작한다.
  - `staleTime: 'static'`인 query에는 효과가 없다(Important Defaults).
  - 로더의 `'static'`은 그 호출 하나에만 적용되는 옵션이다. 컴포넌트 observer의 staleTime과는 다르다 **[추론]**.

### 3.3 낙관적 업데이트와 롤백 (Optimistic Updates 가이드)

**[확인]**

- **UI 방식**: 캐시를 건드리지 않는다. `isPending`일 때 `variables`로 임시 항목을 그린다. 다른 컴포넌트에서는 `useMutationState`와 `mutationKey`를 쓴다. `onSettled`에서 invalidate한다. 한 곳에만 보일 때 권한다.
- **캐시 방식**
  - `onMutate(variables, context)`: `context.client.cancelQueries`로 진행 중인 refetch를 멈추고, `getQueryData`로 스냅숏을 뜬다. `setQueryData`로 낙관 값을 넣고 스냅숏을 돌려준다.
  - `onError(err, variables, onMutateResult, context)`: 스냅숏으로 되돌린다.
  - `onSettled(...)`: invalidate하고 그 promise를 돌려준다.
  - 이 시그니처(마지막 인자 `context.client`)의 도입 버전은 문서에 없다 **[미확인]**.
- Start 가이드는 낙관적 업데이트에 취소, 롤백, 재조정이 필요하다고 짚고, 예제는 이를 쓰지 않는다 **[확인]**.

### 3.4 SSE/WebSocket 이벤트로 무효화 (TkDodo, "Using WebSockets with React Query", 2021-06-06)

**[확인]**

- 권장 방식: 서버는 전체 데이터 대신 "어떤 엔터티(와 id)가 바뀌었다"는 이벤트를 보낸다. 클라이언트는 `invalidateQueries({ queryKey })`를 부른다.
  - 관찰자가 없는 query는 stale 표시만 되고, 다음에 화면에 들어올 때 가져온다. 필요 없는 push 비용이 없다.
- 대안: `setQueryData`나 `setQueriesData`로 부분 갱신한다. 크고 잦은 작은 변경에 쓴다. 다만 추가와 삭제를 못 다루고 타입이 약해서 저자는 invalidation을 선호한다.
- 모든 데이터를 소켓으로 갱신한다면 전역 `staleTime`을 높게(예시는 `Infinity`) 두라고 한다.
- 재연결 시 refetch는 다루지 않는다.
- 2021년 글이라 v3/v4 시대다. 다만 쓰는 API(`invalidateQueries`, `setQueryData`)는 v5에도 그대로 있다.

**[추론] 우리 SSE에 맞추면**

- 런 상태 알림 이벤트(runId, 종류)를 받으면 `['runs','detail',runId]`와 `['runs','list']`(그리고 dashboard·stats 접두사)를 invalidate한다. 화면에 보이는 query만 다시 가져온다.
- SSE가 끊겼다가 다시 붙으면 놓친 이벤트가 있을 수 있다. 재연결 시점에 관련 접두사를 한 번 invalidate한다. 공식 문서에 없는 우리 설계 몫이다.
- SSE가 모든 변경을 덮지 않으면 `Infinity`는 위험하다. 덮지 않는 엔터티(설정, runners 일부)는 유한한 staleTime을 둔다.

## 4. 기본값과 권장 설정

v5 기본값 **[확인]**(Important Defaults, Network Mode, onlineManager, v5 migration):

| 옵션                                                             | 기본                  | 비고                                                                                                                        |
| ---------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `staleTime`                                                      | 0                     | `Infinity`는 수동 invalidate로만 새로 받는다. `'static'`은 invalidate도 무시한다                                            |
| `gcTime`                                                         | 5분                   | 서버에서는 기본 `Infinity`이고 요청이 끝나면 비운다. `0`은 hydration 오류를 낼 수 있어 피하고, 줄인다면 `2 * 1000`을 권한다 |
| `refetchOnMount` / `refetchOnWindowFocus` / `refetchOnReconnect` | true(stale일 때)      | focus는 v5에서 `visibilitychange`만 쓴다                                                                                    |
| `retry`                                                          | 3회, 지수 backoff     | `queryClient.query`는 기본 `retry: false`                                                                                   |
| `structuralSharing`                                              | true                  | JSON 호환 값만 대상이다. 같은 값이면 참조를 유지한다                                                                        |
| `networkMode`                                                    | `'online'`            | 오프라인이면 pause한다. `'always'`는 연결 상태를 무시한다                                                                   |
| onlineManager                                                    | `online: true`로 시작 | `window`의 online/offline 이벤트만 듣는다. `navigator.onLine`은 보지 않는다                                                 |

SSR 권장 **[확인]**: SSR 가이드는 "hydrate 직후 클라이언트가 곧바로 다시 가져오지 않도록 기본 staleTime을 0보다 크게" 두라고 하고 예시로 60초를 쓴다. Start 예제는 30초다.

**[추론] 우리에게 권하는 초기값**

- `staleTime`
  - SSE로 무효화되는 런 계열은 60초 이상으로 두거나 접두사별로 길게 둔다. SSE가 신선도를 맡는다.
  - 그 밖에는 30~60초. 지금 preload 신선도 5초보다 길게 잡아 원격 RTT에서 왕복을 줄인다.
- `gcTime`: 기본 5분을 그대로 둔다.
- `refetchOnWindowFocus`: SSE가 있으면 끄는 것도 고려할 수 있다. 다만 노트북이 잠들었다 깨어나 SSE가 끊겼던 경우를 메우는 안전망이라 stale일 때만 도는 기본값(true)을 유지하는 편이 낫다.
- `refetchOnReconnect`: 기본(true)을 둔다.
- `retry`: 원격 사설망에서 3회 지수 backoff는 실패 표시를 수 초 늦춘다. 읽기 1~2회가 무난하다. mutation은 기본(0)을 유지한다.
- `networkMode`
  - 사설망(VPN)은 기기가 "온라인"이어도 서버에 닿지 않을 수 있고, 반대 경우도 있다. online/offline 이벤트는 기기 네트워크만 반영한다.
  - 기본 `'online'`은 기기가 오프라인일 때만 멈추므로 해롭지 않다. 사설망 끊김은 일반 fetch 실패와 retry로 드러난다.
  - `'always'`는 오프라인 pause와 재연결 refetch 기본값을 잃는다(`refetchOnReconnect` 기본이 false가 된다). 바꿀 이유가 약하다.
- `structuralSharing`: 기본을 유지한다. 서버 함수 응답은 seroval로 직렬화되는데 `Date` 같은 비JSON 값이 섞이면 공유 대상에서 빠질 뿐 오류는 아니다(Important Defaults: JSON 호환 값만).

## 5. 서버 함수를 queryFn으로

- **패턴 [확인]**
  - 공식 예제와 Start 가이드는 `queryFn: () => fetchPost({ data: postId })`처럼 서버 함수를 직접 부른다. queryFn 안에서는 `useServerFn`을 쓰지 않는다.
  - mutation에서는 `useServerFn(save)`로 감싼다.
  - Server Functions 문서: `useServerFn`으로 부르거나 route lifecycle에서 부르면 서버 함수가 던진 redirect와 notFound를 자동으로 처리한다.
  - queryFn에서 던진 redirect는 ssr-query 통합의 `handleRedirects`가 QueryCache `onError`에서 처리한다(소스 확인).
- **권한 [확인]**: 로더는 클라이언트 탐색 때 브라우저에서도 돈다. 권한이 필요한 읽기는 서버 함수 안에서 한다. 개인 데이터 응답에는 `Cache-Control: private, no-store`를 붙인다.
- **오류: throw와 결과 union**
  - **[확인]** Query는 queryFn이 throw하거나 reject해야 error 상태와 retry를 쓴다. `queryClient.query`는 실패하면 throw한다.
  - **[확인]** 서버 함수의 일반 오류는 클라이언트로 직렬화되어 던져진다(Server Functions 문서). 정확한 Error 하위 타입이 보존되는지는 문서에 없다 **[미확인]**.
  - **[추론]** 우리 mutation 서버 함수는 `{ ok: false, ... }` union을 돌려준다(예: `use-settings-actions.ts`). 그대로 `mutationFn`의 결과로 받으면 Query 입장에서는 성공이다.
    - 사용자 입력 오류처럼 화면이 다룰 결과는 union을 유지한다. `onSuccess`에서 `result.ok`일 때만 invalidate한다.
    - 읽기(queryFn)는 실패를 throw로 바꿔 error 경계와 retry를 탄다.
    - retry할 가치가 없는 오류(검증, 404)는 `retry: (n, err) => ...`로 거르거나 `notFound()`를 던진다.
  - **[확인]** 기본 `dehydrate`는 성공한 query만 담는다(SSR 가이드). 다만 ssr-query 통합은 기본 `shouldDehydrateQuery`를 `() => true`로 두고(소스) `shouldRedactErrors`를 넘긴다. 그래서 통합을 쓰면 실패한 query도 보낼 수 있다. 오류 메시지가 HTML에 실릴 수 있으니 확인이 필요하다 **[추론]**.
- **AbortSignal**
  - **[확인]** Query는 queryFn 컨텍스트에 `signal`을 넘긴다. query가 out-of-date나 inactive가 되면 abort된다. signal을 쓰지 않으면 unmount해도 취소하지 않는다.
  - **[확인]** suspense 훅(`useSuspenseQuery` 등)에서는 취소가 동작하지 않는다.
  - **[확인]** Server Functions 문서는 "긴 작업은 `AbortSignal`로 요청 취소를 처리하라"고만 적고, 호출 시그니처(`fn({ data, signal })` 여부)는 보여 주지 않는다. **[미확인]** 서버 함수 호출에 signal을 넘기는 정확한 API와 지원 버전은 확인하지 못했다. 도입 전에 `@tanstack/start-client-core` 타입에서 확인해야 한다.

## 6. 번들 크기 (bundlephobia API, 2026-11-19)

| 패키지                                               | min     | gzip    |
| ---------------------------------------------------- | ------- | ------- |
| `@tanstack/react-query@5.108.0`                      | 46.2 KB | 13.3 KB |
| `@tanstack/query-core@5.108.0`(단독)                 | 40.4 KB | 11.6 KB |
| `@tanstack/react-router-ssr-query@1.167.3`           | 1.6 KB  | 0.7 KB  |
| `@tanstack/router-ssr-query-core@1.169.3`            | 2.8 KB  | 1.2 KB  |
| `@tanstack/react-query-devtools@5.108.0`(기본 entry) | 0.3 KB  | 0.2 KB  |

- react-query 13.3 KB gzip 수치가 query-core를 포함한 값으로 보인다. min 46.2 KB가 core 단독 40.4 KB보다 크기 때문이다 **[추론]**. 실제 증가분은 tree-shaking 뒤 우리 빌드로 재야 한다.
- devtools **[확인]**: "production 빌드에서 제외된다". `process.env.NODE_ENV === 'development'`일 때만 포함된다. 그래서 기본 entry가 0.2 KB다. production에서도 쓰려면 `@tanstack/react-query-devtools/production`을 `React.lazy`로 불러온다. 공식 예제는 root에서 `<ReactQueryDevtools />`를 조건 없이 렌더한다.

## 7. 함정과 알려진 문제

**공식 문서가 짚은 것** **[확인]**(Start 가이드 7절, SSR 가이드)

| 증상                              | 원인과 대응                                                                                                                                           |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| hydrate 직후 같은 읽기가 반복된다 | staleTime 0, key 불일치, QueryClient가 둘 이상. 로더와 컴포넌트가 같은 options 객체를 쓰게 한다. 수동 hydration이나 refetch 끄기로 가리지 말라고 한다 |
| 직접 방문과 탐색 결과가 다르다    | search 검증, `loaderDeps`, key, 서버 전용 경계                                                                                                        |
| mutation 뒤 옛 데이터가 남는다    | 값을 가진 캐시가 Router인지 Query인지, invalidate한 key가 맞는지                                                                                      |
| 다른 계정의 데이터가 보인다       | 모듈 범위 서버 client, 브라우저 캐시 정리, key, 공유 HTTP 캐시                                                                                        |
| SSR이 로딩 상태만 그린다          | 로더가 핵심 데이터를 await했는지, 컴포넌트가 같은 query를 읽는지                                                                                      |
| markup hydration mismatch         | 미리 받지 않은 `useSuspenseQuery`. 서버와 클라이언트가 다른 것을 그린다                                                                               |
| hydration 오류                    | `gcTime: 0`                                                                                                                                           |
| 서버 rejection 경고               | 비블로킹 prefetch에 `.catch(noop)`이 빠졌다                                                                                                           |

**공식 예제가 피하는 방법** **[확인]**

- 요청별 client를 만든다.
- 통합 하나로 provider와 hydration을 처리한다.
- 같은 options 객체를 쓴다.
- deferred route는 Suspense 경계 안에서 `useSuspenseQuery`를 쓴다.
- e2e로 다음을 검사한다(Start 가이드 8절).
  - 쿠키가 다른 동시 SSR 요청이 서로의 값을 담지 않는다.
  - hydration 중 추가 읽기가 0회다.
  - invalidate 뒤 읽기가 정확히 1회다.

**열린 이슈 (TanStack/router GitHub, 2026-11-19 기준 open)**

- **#8795** (2026-10-23): `router-ssr-query-core`가 스트림 종료 시 부르는 `reader.releaseLock()`이 WebKit GC와 교착해 페이지가 멈춘다.
  - Playwright WebKit(Linux, macOS)에서 재현됐다. 실제 Safari 영향은 미확인이다.
  - **우리 영향**: 데스크톱 앱은 Electron(`apps/desktop/package.json`의 `electron` 45.2.3)이라 Chromium으로 그린다. WebKit 웹뷰가 아니어서 직접 대상은 아니다 **[확인]**. 운영자가 Safari나 iOS 브라우저(iOS에서는 모든 브라우저가 WebKit이다)로 웹 화면을 열면 해당될 수 있다 **[추론]**.
  - 1.169.3 소스에도 `finally { reader.releaseLock() }`가 남아 있다 **[확인]**.
- **#7529** (2026-06-03): `router-core@1.171.7+`에서 ssr-query의 query 스트림이 닫히지 않아 60초 "Serialization timeout"이 난다.
  - 보고자의 재현은 Start 없는 커스텀 SSR이다. Start에서도 났다는 댓글이 있지만 Start 최소 재현은 실패했다.
  - 우리 router-core는 1.171.39라서 범위 안이다. 현재 통합 소스는 `onServerSsrAttach` 정리 경로를 더했지만 스트림 종료는 여전히 `onRenderFinished`에 건다 **[확인]**.
  - Start 기본 경로에서 재현되는지는 **[미확인]**이다. 도입 PoC에서 `curl`로 문서 응답이 바로 끝나는지 확인한다.
- **#6347** (2026-01-10): strict 링커(Yarn pnpm linker)에서 `router-ssr-query-core`가 peer `@tanstack/query-core`와 `@tanstack/router-core`를 못 찾는다.
  - 우리는 pnpm 워크스페이스다. 기본 pnpm 설정에서도 재현되는지는 **[미확인]**이다. 대비책으로 `@tanstack/query-core`를 `apps/web` 직접 의존성으로 둘 수 있다.
- **#8234** (2026-09-03): 실패한 배경 reload가 commit된 성공 match를 error match로 바꾼다. Router 쪽 문제로 Query와 무관하지만, `router.invalidate()` 배경 재검증을 쓰는 지금 구조에도 해당될 수 있다 **[추론]**.

## 8. 이행 전략 (~8개 route loader)

- **route 단위 점진 이행이 가능하다 [추론, 근거 있음]**
  - 통합은 `router.options.dehydrate/hydrate`를 감쌀 때 원래 함수를 먼저 부르고 그 결과에 `query` 필드를 더한다(소스). 그래서 Router 자체의 loader 데이터 dehydration과 함께 산다.
  - Query를 쓰지 않는 route의 loader는 지금처럼 `useLoaderData`로 돈다. 캐시에 query가 없으면 `initial`이 비어 있을 뿐이다.
  - 공식 문서가 "섞어 써도 된다"고 명시하지는 않는다. 다만 Start 가이드가 Router 데이터와 Query 데이터를 "주인이 다른 두 캐시"로 나눠 설명하고, 둘 다 invalidate하는 경우를 따로 든다. 공존이 전제다 **[확인]**.
- **전역에 걸리는 변경 (1단계에서 한 번)**
  - `getRouter()`에 요청별 `QueryClient`, `context: { queryClient }`, `setupRouterSsrQueryIntegration`을 넣는다.
  - root를 `createRootRouteWithContext<{ queryClient: QueryClient }>()`로 바꾼다.
  - `defaultPreloadStaleTime`을 Query route만 0으로 둘 수 있다. route별 `preloadStaleTime`을 0으로 주고 전역은 5000으로 유지하는 식이다. route 옵션 `preloadStaleTime`은 Data Loading 문서 맥락상 있다고 보지만 정확한 이름은 **[미확인]**이다. 전부 옮긴 뒤 전역을 0으로 바꾼다 **[추론]**.
- **권장 순서 [추론]**
  1. 1단계 배선만 넣고 Query route 0개로 배포한다. HTML 응답 종료(#7529), 데스크톱 웹뷰(#8795), pnpm 해석(#6347)을 확인한다.
  2. SSE 효과가 가장 큰 runs 목록과 run 상세를 먼저 옮긴다.
     - `queryOptions` 팩토리를 만들고, 로더는 `queryClient.query({...opts, staleTime:'static'})`, 컴포넌트는 `useSuspenseQuery`로 바꾼다.
     - SSE 핸들러가 `invalidateQueries`를 부르게 한다.
     - 해당 route의 mutation은 `router.invalidate()`에서 `invalidateQueries`로 바꾼다.
  3. dashboard(`/_app/`)와 stats를 옮긴다. 시간대를 key에 넣는다.
  4. runners와 tickets를 옮긴다.
  5. settings와 onboarding을 옮긴다. 로더가 트래커 프로젝트, 상태, 라벨을 한꺼번에 읽으므로 key를 쪼갤지 정한다.
  6. root와 `_app` 로더(시간대, title bar, 온보딩 완료)는 `shouldReload: false` 그대로 Router에 남겨도 된다. 앱 전역 context는 `router.invalidate()`가 주인이다.
- **섞인 기간의 주의 [추론]**
  - 한 mutation이 옮긴 화면과 남은 화면을 모두 바꾸면 `invalidateQueries`와 `router.invalidate()`를 둘 다 부른다.
  - e2e에 "hydration 중 추가 읽기 0회"와 "invalidate 뒤 읽기 1회" 검사를 공식 예제처럼 넣는다.

## 9. 확인하지 못한 것

- 서버 함수 호출에 `AbortSignal`을 넘기는 API와 지원 버전.
- `onMutate(variables, context)`, `context.client` 시그니처의 도입 버전.
- route 단위 `preloadStaleTime` 옵션의 정확한 이름과, `shouldReload` 함수와 `defaultPreloadStaleTime: 0`이 함께 동작하는 방식.
- #7529가 Start 기본 경로(`renderRouterToStream`)와 우리 버전 조합에서 재현되는지.
- #8795가 실제 Safari나 iOS 브라우저에서도 일어나는지.
- 서버 함수가 직렬화한 Error의 하위 타입이 보존되는지.
- `queryClient.query`의 `'static'` 변형과 `query(opts)` 변형 중 공식이 어느 쪽을 최종 권장하는지. 문서끼리 다르다.

## 출처

- TanStack Router, TanStack Query Integration: https://tanstack.com/router/latest/docs/integrations/query
- TanStack Router, External Data Loading: https://tanstack.com/router/latest/docs/framework/react/guide/external-data-loading
- TanStack Router, Data Loading: https://tanstack.com/router/latest/docs/framework/react/guide/data-loading
- TanStack Start, TanStack Query 가이드: https://tanstack.com/start/latest/docs/framework/react/guide/tanstack-query
- TanStack Start, Server Functions: https://tanstack.com/start/latest/docs/framework/react/guide/server-functions
- TanStack Query, QueryClient reference: https://tanstack.com/query/latest/docs/reference/QueryClient
- TanStack Query, Migrating to v5: https://tanstack.com/query/latest/docs/framework/react/guides/migrating-to-v5
- TanStack Query, Important Defaults: https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults
- TanStack Query, Server Rendering & Hydration: https://tanstack.com/query/latest/docs/framework/react/guides/ssr
- TanStack Query, Optimistic Updates: https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates
- TanStack Query, Query Cancellation: https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation
- TanStack Query, Network Mode: https://tanstack.com/query/latest/docs/framework/react/guides/network-mode
- TanStack Query, onlineManager: https://tanstack.com/query/latest/docs/reference/onlineManager
- TanStack Query, Devtools: https://tanstack.com/query/latest/docs/framework/react/devtools
- TkDodo, Using WebSockets with React Query (2021-06-06): https://tkdodo.eu/blog/using-web-sockets-with-react-query
- query-core 5.102.0 릴리스(`query`/`infiniteQuery` 추가, 명령형 메서드 deprecate): https://github.com/TanStack/query/releases/tag/%40tanstack%2Fquery-core%405.102.0 , PR https://github.com/TanStack/query/pull/10658
- 공식 예제 start-basic-react-query: https://github.com/TanStack/router/tree/main/examples/react/start-basic-react-query (`src/router.tsx`, `src/routes/__root.tsx`, `src/routes/posts.$postId.tsx`, `src/routes/deferred.tsx`, `src/utils/posts.tsx`, `package.json`)
- 통합 소스: https://github.com/TanStack/router/blob/main/packages/router-ssr-query-core/src/index.ts
- 이슈: https://github.com/TanStack/router/issues/8795 , https://github.com/TanStack/router/issues/7529 , https://github.com/TanStack/router/issues/6347 , https://github.com/TanStack/router/issues/8234
- npm 레지스트리(`npm view`, 2026-11-19): https://www.npmjs.com/package/@tanstack/react-query , https://www.npmjs.com/package/@tanstack/react-router-ssr-query , https://www.npmjs.com/package/@tanstack/router-ssr-query-core
- bundlephobia API(2026-11-19): https://bundlephobia.com/package/@tanstack/react-query@5.108.0 , https://bundlephobia.com/package/@tanstack/react-router-ssr-query@1.167.3 , https://bundlephobia.com/package/@tanstack/router-ssr-query-core@1.169.3 , https://bundlephobia.com/package/@tanstack/react-query-devtools@5.108.0 , https://bundlephobia.com/package/@tanstack/query-core@5.108.0
