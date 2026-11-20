---
status: done
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

- [x] 위 1~7 배선과 공용 로더 도구. 화면 동작은 바뀌지 않는다.
- [x] 8·9·10의 확인 결과를 이 티켓에 적었다. 재현된 이슈가 없다.
- [x] 시험: 서버 렌더한 화면에서 hydration이 끝날 때까지 서버 함수 호출이 늘지 않는다(지금과 같은 수).
- [x] 시험: 쿠키가 다른 동시 서버 렌더 요청이 서로의 값을 담지 않는다(요청별 `QueryClient`).
- [x] 0117 브라우저 시험(`e2e/src/navigation.test.ts`)이 같은 뜻으로 통과한다(스펙 7절 5번).
- [x] 클라이언트 묶음 크기 전·후(`e2e/src/measure-navigation.ts --client`)를 적었다.

## 확인 결과(2026-11-20)

설치한 버전: `@tanstack/react-query` 5.108.0, `@tanstack/query-core` 5.108.0(통합의 peer로 pnpm이 찾음), `@tanstack/react-router-ssr-query` 1.167.3(→ `router-ssr-query-core` 1.169.3), 개발용 `@tanstack/react-query-devtools` 5.108.0. 라우터는 그대로 `@tanstack/react-router` 1.170.46(→ `router-core` 1.171.39), `@tanstack/react-start` 1.169.5다. 5.108.1이 하루 전(2026-11-19)에 나왔지만 pnpm 최소 공개 기간 검사 안이라 5.108.0을 정확한 버전으로 넣었다.

### 만든 것

- `apps/web/src/query/query-client.ts`: 기본값 상수(`DB_STALE_TIME_MS` 30초, `QUERY_GC_TIME_MS` 5분, `READ_RETRY_COUNT` 1)와 `createQueryClient()`. 창 포커스·재연결 다시 읽기는 명시해 켰다.
- `apps/web/src/query/route-query.ts`: 화면 티켓(0125~0127)이 쓰는 로더 도구 `loadRouteQuery(load, options)`와 `PRELOAD_FRESH_MS`(5초, 라우터 전역 `defaultPreloadStaleTime`도 이 값을 쓴다).
- `apps/web/src/router.tsx`: `getRouter()` 안에서 `createQueryClient()`, `context: { queryClient }`, `setupRouterSsrQueryIntegration`.
- `apps/web/src/routes/__root.tsx`: `createRootRouteWithContext<{ queryClient: QueryClient }>()`. `beforeLoad`, 로더, `shouldReload: false`는 그대로다. devtools는 `import.meta.env.DEV`일 때만 `lazy`로 불러 `ClientOnly` 안에 그린다(왼쪽 아래 단추).
- `apps/web/src/testing/query-probe-routes.tsx`: 시험 전용 route tree. 제품 route tree에는 없고, 브라우저 시험(`e2e/src/query-cache.test.ts`)이 vite 플러그인으로 `router.tsx`의 `./routeTree.gen`을 이 모듈로 바꿔 쓴다.

화면 쪽 사용 방법(0125~0127):

```ts
const runsQuery = (ws: string) => queryOptions({ queryKey: [...], queryFn: ({ signal }) => getRunsPage({ data: { ws }, signal }) });
createFileRoute(...)({
  preloadStaleTime: 0,
  loader: (load) => loadRouteQuery(load, runsQuery(...)),
  component: () => { const { data } = useSuspenseQuery(runsQuery(...)); ... },
});
```

옮긴 route에는 `shouldReload`를 두지 않는다(아래 7). 기본값과 다른 `staleTime`(Linear 5분)은 그 `queryOptions`에 적는다.

### 4. 기본 retry와 `queryClient.query`

`queryClient.query`는 옵션에 `retry`가 없을 때만 `retry: false`를 넣는다(query-core 5.108.0 `queryClient.ts:619`). 그 전에 `defaultQueryOptions`가 `defaultOptions.queries`를 펼치므로 기본 `retry: 1`이 로더에도 먹는다. `query-client.test.ts`가 첫 읽기가 실패하면 한 번 더 읽어 성공하는 것과, 두 번 다 실패하면 throw하는 것을 시험한다. 서버 렌더에서도 retry 1이 먹는다(아래 10의 `fetchFailureCount:2`). 그래서 서버 렌더 중 읽기가 실패하면 retry 대기(기본 1초)만큼 응답이 늦는다.

### 5. devtools가 프로덕션 묶음에 없음

`pnpm --filter @ganger/web build` 뒤 `apps/web/dist`(client, server, srvx) 어디에도 `ReactQueryDevtools`·`query-devtools` 문자열이 없다. 시험 전용 route(`query-probe`)도 없다.

### 7. 라우터 설정과 route 옵션

전역 `defaultPreload: "intent"`, `defaultPreloadStaleTime: 5000`은 그대로다. 설치한 `router-core` 1.171.39 `load-client.ts`의 `createLoaderTask`를 읽었다.

- route 단위 옵션 이름은 `preloadStaleTime`(미리 읽은 match)과 `staleTime`(이동으로 읽은 match)이다. 고르는 식: 미리 읽기이거나 그 match가 미리 읽기로 채워졌으면 `route.preloadStaleTime ?? defaultPreloadStaleTime ?? 30_000`, 아니면 `route.staleTime ?? defaultStaleTime ?? 0`.
- `shouldReload`가 정해져 있으면(`false`든 함수가 돌려준 값이든) 신선도 계산을 통째로 건너뛴다. `reload = match.invalid || configured || (configured === undefined && 나이 >= staleAge && …)`. 그래서 `shouldReload`는 `preloadStaleTime`보다 앞선다. `false`면 `router.invalidate()`(`match.invalid`)가 아니고는 다시 돌지 않고, 함수가 참을 돌려주면 5초 안에 미리 읽었어도 다시 돈다. research 0016 1절의 Runners `reloadOnEnter` **[추정]**(미리 읽은 뒤 들어가도 또 읽음)은 이 식으로 맞다.
- 그래서 Query로 옮긴 route는 `shouldReload`를 지우고 `preloadStaleTime: 0`만 준다. 그러면 미리 읽기와 이동마다 로더가 돌고, 요청할지는 `loadRouteQuery`와 Query 캐시가 정한다.
- 이미 그려진(success) match를 다시 읽을 때 라우터는 기다리지 않고 뒤에서 읽는다(`defaultStaleReloadMode`가 `blocking`이 아니면). 이동하는 동안 같은 match의 미리 읽기가 아직 돌고 있으면 라우터가 그 실행을 이어받아 로더를 한 번만 돌린다.

### 8. 로더 API와 0117 계약

설치한 query-core 5.108.0에 `queryClient.query`가 있고 `ensureQueryData`·`fetchQuery`·`prefetchQuery`는 deprecated다. `query({ ...options, staleTime: "static" })`는 캐시가 있으면 신선도와 상관없이 그 값을 돌려준다(소스 주석과 시험으로 확인). `loadRouteQuery`가 이것을 쓴다.

- **이동(`cause: "enter"`).** `staleTime: "static"`으로 읽는다. 캐시가 없으면 기다리고, 있으면 바로 넘어간다. 캐시가 있었고, 브라우저이고, 이번 이동을 위해 5초 안에 미리 읽은 데이터가 아니면 `query({ ...options, staleTime: 0 })`로 기다리지 않는 다시 읽기를 시작한다. 진행 중인 읽기가 있으면 query-core가 그것과 합친다.
- **미리 읽기를 알아보는 방법.** 로더 context의 `preload`가 참인 읽기가 캐시의 `dataUpdatedAt`을 바꿨으면, 그 `QueryClient`에 매인 `WeakMap` 표에 query hash와 그 `dataUpdatedAt`을 적는다. 이동할 때 표의 값을 꺼내 지우고, 그 값이 지금 `dataUpdatedAt`과 같고 5초가 안 지났으면 다시 읽지 않는다. 기준은 "이 데이터를 미리 읽기가 가져왔는가"라서 `dataUpdatedAt`만 보지 않는다. 서버 렌더로 받은 캐시에는 표시가 없어 1~2초 안에 돌아와도 다시 읽는다.
- **스펙이 0123에 맡긴 질문: 한 번 본 화면에 포인터를 올릴 때.** 미리 읽기는 `staleTime: "static"`이 아니라 query의 staleTime(DB 30초)을 본다. 30초 안이면 요청하지 않고(표시도 남기지 않아 누르면 뒤에서 다시 읽는다), 지났으면 미리 읽기가 새로 읽고 바로 누르면 더 읽지 않는다.
- **같은 화면 안의 다시 읽기(`cause: "stay"`, 검색 조건이 바뀌지 않은 `router.invalidate()` 등)** 는 뒤에서 다시 읽지 않는다. 옮긴 화면의 쓰기는 key 무효화를 쓴다(research 0015 2절).
- **서버**(`document`가 없음)에서는 뒤에서 다시 읽지 않는다. 같은 요청 안에서 같은 key를 두 번 읽어도 한 번만 읽는다.

시험:

- `apps/web/src/query/route-query.test.ts`(11개): 처음 들어가면 기다림, 다시 들어가면 기다리지 않고 캐시를 돌려준 뒤 뒤에서 읽음, 5초 안 미리 읽기는 다시 읽지 않음, 5초가 지나면 뒤에서 읽음, 미리 읽기 표시는 한 번만 씀, 서버 렌더 캐시에 1.5초 뒤 들어오면 뒤에서 읽음, 한 번 본 화면 미리 읽기의 30초 경계 두 가지, 미리 읽기가 도는 중에 들어가면 그 요청을 함께 기다림, `stay`는 다시 읽지 않음, 서버는 다시 읽지 않음.
- `e2e/src/query-cache.test.ts`(브라우저, 실제 라우터와 서버 함수): 포인터로 미리 읽은 화면은 누를 때 다시 읽지 않음, 미리 읽은 지 5초가 지나면 뒤에서 다시 읽음, 서버 렌더로 연 화면을 떠났다 바로 돌아오면 다시 읽음(`navigation.test.ts:122-131`과 같은 시나리오), 한 번 본 화면에 다시 들어가면 뒤에서 다시 읽음.
- 0117 시험 `e2e/src/navigation.test.ts` 세 개가 그대로 통과한다. 아직 옮긴 화면이 없어 기대는 바꾸지 않았다.

### 9. 열린 상류 이슈 확인(C2)

셋 모두 재현되지 않았다.

- **#7529(문서 응답이 닫히지 않음).** 시험 전용 route를 붙인 프로덕션 빌드를 `srvx --prod`로 띄우고 `curl`로 받았다. `/query-probe`(query를 서버 렌더) 0.005초, `/query-probe-error`(실패한 query, 500) 0.005초, `/`·`/runs`·`/stats`·`/runners`는 0.008~0.014초, `/settings` 0.51초, `/tickets` 0.75초(가짜 트래커의 지연)에 응답이 끝났다. 60초 "Serialization timeout"은 없다. HTML 끝에 query 스트림의 `return(void 0)`과 `$_TSR.e()`가 있다.
- **#8795(WebKit 멈춤).** Playwright WebKit 27.2(playwright webkit 2388)로 개발 서버와 위 프로덕션 서버를 열었다. 서버 렌더 7개 화면, 클라이언트 이동 3~5바퀴, 문서 다시 열기, 레일 링크 누르기를 하며 단계마다 큰 배열을 만들어 GC를 부추기고 `evaluate`가 응답하는지 봤다. 모든 단계가 10초 안에(대부분 2ms 안) 응답했고 프로덕션에서는 오류 로그도 없었다. 데스크톱 앱과 같은 Electron 45.2.3 바이너리에 창 하나를 띄워 프로덕션 서버로 같은 일을 했고 멈추지 않았다. 실제 Safari 26.5는 원격 자동화가 꺼져 있어(`safaridriver` 세션을 만들지 못함) 자동으로 보지 못했다.
  - 개발 서버에서 처음 한 번, hydration이 끝나기 전에 바로 이동할 때 React의 "error while hydrating … recover" 로그가 났다. 멈춤은 아니었고, 같은 순서를 WebKit·Chromium에서 세 번 더 돌렸을 때는 나지 않았다. 새 캐시 폴더로 처음 띄운 개발 서버가 의존성을 미리 묶는 중이었던 것으로 본다 **[추정]**.
- **#6347(peer를 못 찾음).** 이 브랜치를 새로 clone해 `pnpm install --frozen-lockfile` 뒤 `vite dev`(문서 응답 200), `pnpm run build`, `pnpm run bundle`, `pnpm run smoke:web`, `pnpm run smoke:bundle`이 모두 통과했다. pnpm이 `router-ssr-query-core`에 `query-core@5.108.0`과 `router-core@1.171.39`를 peer로 이어 준다. 그래서 `@tanstack/query-core`를 직접 의존성으로 넣지 않았다.

### 10. `AbortSignal`, 오류의 서버 렌더, 오류가 보이는 곳

- **`AbortSignal`.** `@tanstack/start-client-core` 1.170.39의 서버 함수 호출 옵션에 `signal`이 있다(`CompiledFetcherFnOptions`, `FetcherBaseOptions`). 클라이언트 middleware를 거쳐 `fetch`에 넘어간다. 그래서 `queryFn: ({ signal }) => getRunsPage({ data, signal })`처럼 쓴다(시험 route가 이렇게 쓰고 typecheck가 통과한다). 서버 쪽 handler context(`ServerFnCtx`)에는 `signal`이 없다. 서버에서 요청 취소를 보려면 `@tanstack/react-start/server`의 요청 객체를 써야 하고 이것은 확인하지 않았다. Query 문서대로 `useSuspenseQuery`에서는 취소가 동작하지 않는다.
- **실패한 query의 오류가 서버 렌더 HTML에 실린다.** 통합의 기본 `shouldDehydrateQuery`가 모든 query를 보내서, 실패한 query의 `state.error`·`fetchFailureReason`이 HTML에 직렬화된다. 다만 같은 오류 객체를 라우터가 이미 실패한 match의 `e:`로 싣고 있고, query 상태는 그 객체를 가리킨다(`error:$R[n]`). Query가 새로 드러내는 내용은 없다. `fetchFailureCount:2`라 서버에서도 retry 1이 먹었다. `shouldRedactErrors`는 진행 중인 promise의 거절만 가린다. 시험: `query-cache.test.ts`의 "실패한 query는 retry 1번 뒤 …".
- **오류가 보이는 곳(스펙 열린 질문 4).** route별 `errorComponent`와 라우터 `defaultErrorComponent`가 없어서:
  - 서버 렌더: 실패한 match 자리에 라우터 기본 `ErrorComponent`("Something went wrong!")를 그린다. `_app` 안 화면이면 셸(레일)은 남고 응답은 500이다.
  - hydration 뒤: 클라이언트는 실패한 match에서 오류를 다시 던지고, 가장 가까운 경계인 루트의 `RootError`가 셸까지 화면 전체를 대신한다.
  - 클라이언트 이동: 루트 `RootError`가 레일까지 화면 전체를 대신한다.
  - 시험: `query-cache.test.ts`의 "셸 안 화면의 query가 throw하면 …" 두 개. route별 오류 화면을 둘지는 0125를 시작할 때 정한다.

### 시험과 측정

- hydration 동안 서버 함수 호출: `/query-probe`, `/runs`, `/tickets`를 서버 렌더로 열고 라우터가 쉬고 네트워크가 잠잠해질 때까지 `/_serverFn/` 요청이 0개다. 이 브랜치 전 `develop`에서도 `/runs`·`/tickets`는 0개였다.
- 요청별 `QueryClient`: 시간대 쿠키가 다른 요청 12개(4가지 × 3)를 동시에 보내 각 HTML의 query 값과 dehydrate한 query가 자기 쿠키 값만 담는 것을 본다. `QueryClient`를 모듈 범위로 옮기면 이 시험이 실패하는 것을 확인했다.
- 클라이언트 묶음 크기(`node e2e/src/measure-navigation.ts --client apps/web/dist/client`, 같은 서버에 묶음 폴더만 바꿔 잼):

|                       | chunk | 전체 KiB | gzip KiB | `index` chunk KiB(gzip) |
| --------------------- | ----: | -------: | -------: | ----------------------: |
| 전(`develop` a0da36d) |    37 |   1227.7 |    398.3 |             293.1(92.9) |
| 후(이 티켓)           |    37 |   1254.6 |    406.0 |            320.0(100.5) |
| 차이                  |     0 |    +26.9 |     +7.7 |             +26.9(+7.6) |

## 머지 위험

의존성과 라우터 배선을 바꾸지만 저장 형식은 바꾸지 않아 two-way다. 닿는 곳은 web 전체다.
