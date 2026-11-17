# 웹 스택 스파이크: TanStack Start + StyleX + UI SDK + TS 7

2026-11-17에 한 기술 스파이크 결과다. ADR 0002·0003이 정한 조합이 이 저장소의 엄격한 설정(TS 7 strict 옵션 세트, oxlint type-aware, oxfmt, pnpm + Turborepo, Node 24)에서 함께 도는지 확인했다. 스파이크 코드는 커밋하지 않았고, 이 문서만 남긴다.

## 결론

조합은 함께 돈다. 막힌 곳은 없고, 우회가 필요한 곳이 다섯 군데 있다.

| #   | 질문                                                                                       | 결과                                                              |
| --- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| 1   | TanStack Start 최소 앱(라우트 2개, server function, server route, dev, 프로덕션 빌드·실행) | 된다                                                              |
| 2   | StyleX `defineVars` 토큰과 컴포넌트 스타일, SSR 깜박임, CSS 추출                           | 된다                                                              |
| 3   | UI SDK 메뉴를 StyleX로 스타일링, SSR·하이드레이션 경고                                     | 된다                                                              |
| 4   | `tsc --noEmit`(TS 7)가 strict 옵션 세트에서 통과                                           | 우회하면 된다(웹 앱만 모듈 해석 옵션 변경, strict 계열 완화 없음) |
| 5   | oxlint type-aware, oxfmt 통과                                                              | 우회하면 된다(StyleX 플러그인 `any` 반환, 생성 파일 포맷 제외)    |
| 6   | 타입 안전한 i18n 메시지 키                                                                 | 된다(키), 우회 필요(ICU 인자 타입)                                |
| 7   | `apps/worker` Node 데몬이 같은 tsconfig·빌드 체계에서 동작                                 | 된다                                                              |

ADR 0002·0003을 바꿀 근거는 찾지 못했다. 다만 ADR 0005의 "npm 패키지 하나로 배포"와 엮인 후속 결정이 하나 생겼다(아래 "남은 위험").

## 정확한 버전

실제로 설치해 돌린 버전이다. 런타임은 Node 24.22.2, pnpm 12.21.0.

| 패키지                                   | 버전                       |
| ---------------------------------------- | -------------------------- |
| `@tanstack/react-start`                  | 1.169.5                    |
| `@tanstack/react-router`                 | 1.170.46                   |
| `@tanstack/router-plugin`(전이)          | 1.169.0                    |
| `@tanstack/start-plugin-core`(전이)      | 1.171.56                   |
| `@tanstack/start-server-core`(전이)      | 1.169.45                   |
| `vite`                                   | 8.3.8(rolldown 1.2.19)     |
| `@vitejs/plugin-react`                   | 6.3.0                      |
| `react`, `react-dom`                     | 19.3.1                     |
| `@types/react`, `@types/react-dom`       | 19.3.0                     |
| `@stylexjs/stylex`, `@stylexjs/unplugin` | 0.19.2                     |
| `lightningcss`(전이)                     | 1.33.0                     |
| `@ui-sdk/react`, `@ui-sdk/core`          | 0.1.0-beta.6               |
| `srvx`                                   | 1.0.8                      |
| `use-intl`                               | 4.15.1                     |
| `zod`                                    | 4.6.7                      |
| `typescript`                             | 7.0.2                      |
| `oxlint` / `oxlint-tsgolint` / `oxfmt`   | 1.93.0 / 7.0.2007 / 0.78.0 |
| `turbo`                                  | 2.11.11                    |

모든 런타임 의존성은 `--save-exact`로 고정했다.

## 질문별 결과

### 1. TanStack Start 최소 앱 — 된다

`apps/web`에 `/`와 `/runs/$runId` 라우트, server function `greet`, server route `POST /webhooks/linear`(본문 echo)를 만들었다.

- dev(`vite dev`)에서 SSR HTML이 나오고, 하이드레이션 뒤 클라이언트 내비게이션과 loader 재호출이 동작한다.
- 프로덕션은 `vite build`가 `dist/client`와 `dist/server/server.js`(fetch 핸들러)를 만든다. Nitro 없이 `srvx`로 실행했다. Nitro의 Vite 플러그인은 문서에서 nightly 설치를 권하고 있어 고르지 않았다.

  ```json
  "build": "vite build",
  "start": "srvx --prod -s ../client dist/server/server.js"
  ```

- server route는 `createFileRoute`의 `server.handlers`로 만든다. `curl -X POST -d hello`에 `hello`가 돌아왔다.
- server function의 **출력** 타입은 클라이언트까지 이어진다. loader 결과의 `at`은 `Date`로, `pid`는 `number`로 추론되고, 없는 속성을 읽으면 `tsc`가 실패한다.
- **입력** 타입은 검증기에 달렸다. 검증 함수의 인자가 `unknown`이면 호출부의 잘못된 입력(`name: 1`)을 잡지 못한다. 검증기로 zod 스키마(Standard Schema)를 넘기면 입력 타입도 호출부까지 이어져 `tsc`가 잡는다.

  ```ts
  const GreetInput = z.object({ name: z.string(), times: z.number().int().positive() });
  export const greet = createServerFn({ method: "POST" })
    .validator(GreetInput)
    .handler(({ data }) => ({ message: data.name.repeat(data.times), at: new Date() }));
  ```

- 주의: 이 버전의 메서드 이름은 `.validator()`다. 일부 문서·예제에 나오는 `.inputValidator()`는 1.169.5에 없어 런타임에서 `is not a function`으로 실패한다. 타입 검사로도 잡힌다.
- Vite 플러그인 순서는 `stylex.vite()` → `tanstackStart()` → `viteReact()`다. Start는 React 플러그인보다 앞이어야 하고, StyleX 문서는 Fast Refresh를 위해 StyleX를 프레임워크 플러그인보다 앞에 두라고 한다.

### 2. StyleX — 된다

- `defineVars` 토큰은 `*.stylex.ts` 파일에 이름 있는 export로만 둔다(StyleX 규칙). 컴포넌트는 `stylex.create` + `stylex.props`를 쓴다.
- dev에서는 StyleX가 `/virtual:stylex.css`를 제공한다. 루트 셸의 `<head>`에 dev 전용 링크를 직접 넣어야 한다.

  ```tsx
  {
    import.meta.env.DEV ? <link rel="stylesheet" href="/virtual:stylex.css" /> : null;
  }
  ```

- 프로덕션에서는 StyleX CSS가 앱의 CSS 자산(`app.css?url`을 루트 `head().links`로 연결)에 덧붙어 `dist/client/assets/app-*.css`로 나온다. 덧붙일 CSS 자산이 하나는 있어야 하므로 빈에 가까운 `app.css`를 둔다. `useCSSLayers: true`로 `@layer priority1..` 순서가 생긴다.
- 깜박임 없음: SSR HTML의 `<head>`에 스타일시트 링크가 있고, JS를 끈 브라우저 컨텍스트에서도 트리거 버튼 배경색이 토큰 값으로 계산됐다.
- dev 빌드는 디버그용 클래스(`__root__styles.body`)와 `data-style-src` 속성을 붙인다. 프로덕션에는 없다.
- 확인할 점: 기본 lightningcss 설정이 OKLCH 토큰을 hex + `lab()` 폴백으로 바꾼다. 색이 틀리지는 않지만 결과 CSS에 `oklch()`가 남지 않는다. 0003 디자인 시스템에서 OKLCH를 그대로 내보내려면 `lightningcssOptions.targets`를 정해야 한다.

### 3. UI SDK — 된다

- `@ui-sdk/react/menu`의 `Menu`·`MenuTrigger`·`MenuContent`·`MenuItem`을 썼다. 각 부품은 `className`·`style`을 받으므로 `{...stylex.props(styles.x)}`를 그대로 펼칠 수 있다.
- 상태별 스타일은 두 길이 있다. UI SDK는 `data-highlighted` 같은 속성을 붙이지만 StyleX는 임의의 속성 선택자를 쓰기 어렵다. 그래서 `className`에 상태 함수를 넘겨 StyleX 클래스를 고르는 방식을 썼다.

  ```tsx
  <MenuItem value="retry" className={(s) => cx(styles.item, s.highlighted && styles.highlighted)} />
  // cx = (...s) => stylex.props(...s).className ?? ""
  ```

- SSR에서 트리거가 `aria-haspopup="menu"`, `aria-expanded="false"`, `data-closed`로 렌더된다. 헤드리스 Chrome으로 dev·프로덕션 모두에서 열기 → 화살표 → Enter 선택이 동작했고, 콘솔에 하이드레이션 경고가 없었다(남은 오류는 favicon 404 하나).
- UI SDK 모듈은 `"use client"`를 포함하지만 RSC를 쓰지 않는 Start에서는 영향이 없다.
- pnpm 12의 기본 `minimumReleaseAge`가 하루 안에 나온 `0.1.0-beta.6`(2026-11-16 공개) 설치를 막아, `pnpm add`가 `pnpm-workspace.yaml`에 `minimumReleaseAgeExclude`를 추가했다. 베타 버전을 올릴 때마다 같은 일이 생긴다. 하루 기다리거나, 해당 버전을 명시적으로 제외 목록에 넣는다.

### 4. TS 7 typecheck — 우회하면 된다

strict 계열 옵션(`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `noPropertyAccessFromIndexSignature`, `isolatedModules`)은 하나도 완화하지 않고 통과했다. 대신 `apps/web/tsconfig.json`에서 아래를 덮어써야 한다.

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["es2024", "dom", "dom.iterable"],
    "types": ["node", "vite/client"],
    "jsx": "react-jsx",
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true
  },
  "include": ["src", "messages", "vite.config.ts"]
}
```

- `moduleResolution: nodenext`를 그대로 두면 실패한다. 생성되는 `routeTree.gen.ts`와 Start 관례가 확장자 없는 상대 import(`./routes/index`)를 쓰고, `@stylexjs/unplugin`의 타입도 nodenext로는 `vite` 속성을 찾지 못한다. 번들러가 해석하는 웹 앱이라 `bundler`가 맞다. 완화가 아니라 실행 환경에 맞춘 변경으로 본다.
- `routeTree.gen.ts`는 파일 맨 위에 `// @ts-nocheck`가 있어 그 자체는 검사되지 않는다. 대신 `Register` 보강으로 라우트 경로·params·loader 데이터 타입이 앱 코드에 이어지고, 그쪽은 검사된다.
- 걸린 것: `stylex.props`가 오버로드라 `Parameters<typeof stylex.props>`가 `never`가 된다. 도우미 인자 타입은 `ReadonlyArray<stylex.StyleXStyles | false>`처럼 직접 쓴다.

### 5. oxlint type-aware, oxfmt — 우회하면 된다

- oxlint type-aware는 `apps/web`의 TSX에도 적용된다(일부러 넣은 floating promise를 잡았다). `routeTree.gen.ts`는 파일의 `/* eslint-disable */`로 건너뛴다.
- 막힌 곳 하나: `@stylexjs/unplugin`의 `vite()`(루트 export와 `./vite` 하위 경로 둘 다)가 반환 타입을 `any`로 선언해 `no-unsafe-assignment`에 걸린다. 타입 단언으로 감싸면 통과한다.

  ```ts
  const stylexPlugin = stylex.vite as (options?: Parameters<typeof stylex.vite>[0]) => PluginOption;
  ```

- oxfmt는 생성 파일을 다시 포맷하려 해 실패한다. `.oxfmtrc.json`의 `ignorePatterns`에 `**/routeTree.gen.ts`를 넣어야 한다. `pnpm add`가 쓴 `pnpm-workspace.yaml`(작은따옴표)도 oxfmt 기준과 달라 한 번 포맷해야 한다.

### 6. i18n — 키는 된다, ICU 인자 타입은 우회 필요

`use-intl`을 붙였다. 메시지는 `apps/web/messages/{ko,en}.json`에 두고 `AppConfig` 보강으로 타입을 건다.

```ts
import ko from "../messages/ko.json" with { type: "json" };
declare module "use-intl" {
  interface AppConfig {
    Locale: "ko" | "en";
    Messages: typeof ko;
  }
}
```

- 컴포넌트는 `useTranslations("menu")`, 라우트 `head()`처럼 React 밖은 `createTranslator`를 쓴다. 루트 레이아웃에 `IntlProvider`를 둔다.
- 없는 키(`"retri"`, `"nav.nope"`)는 `tsc`가 잡는다.
- 못 잡는 것: JSON import는 값을 `string`으로 넓혀 ICU 인자(`{value}`) 누락을 잡지 못한다. 메시지를 `as const` TS 파일로 두거나 선언 파일을 생성해야 한다. `en.json`이 `ko.json`과 같은 키를 갖는지도 따로 검사해야 한다(`satisfies typeof ko` 또는 테스트).

후보 비교(붙인 것은 `use-intl` 하나다).

| 후보                          | 장점                                                                                                                              | 단점                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `use-intl` 4.15.1             | 런타임 하나로 끝나고 빌드 단계가 없다. ICU 문법, 날짜·숫자 포맷 내장. `AppConfig`로 키 타입 안전. SSR에서 별도 설정 없이 동작했다 | JSON이면 ICU 인자 타입을 못 잡는다. 메시지 전체가 번들에 들어간다                             |
| Paraglide JS 3.2.2            | 컴파일러가 메시지마다 타입 있는 함수를 생성해 키·인자 모두 타입 안전, 쓰는 메시지만 번들에 남는다. TanStack 쪽 예제가 있다        | 생성 파일이 늘어 tsc·oxlint·oxfmt 제외 설정이 더 필요하다. inlang 프로젝트 구조를 따라야 한다 |
| i18next 27 + react-i18next 18 | 생태계가 가장 크고 플러그인이 많다. `CustomTypeOptions`로 키 타입 안전                                                            | 무겁고, ICU는 별도 플러그인이다. 타입 보강이 복잡해 strict 설정에서 손이 더 간다              |

이번 범위(운영자 한 명, 한국어 우선, 화면 수 적음)에서는 `use-intl`이 가장 가볍다. ICU 인자까지 타입으로 잡아야 한다면 Paraglide를 다시 본다.

### 7. `apps/worker` — 된다

- 같은 `tsconfig.base.json`(nodenext)을 그대로 쓰고, Node 24의 타입 스트리핑으로 빌드 없이 `node src/index.ts`로 돈다. `@factory/core`(원본 `.ts`를 export하는 워크스페이스 패키지)도 불러온다.
- `apps/worker/tsconfig.json`에 두 옵션을 더한다. 상대 import에 `.ts` 확장자를 쓰고, 타입 스트리핑이 못 지우는 문법(enum, namespace, 매개변수 속성)을 막는다.

  ```json
  "compilerOptions": { "allowImportingTsExtensions": true, "erasableSyntaxOnly": true }
  ```

- `AbortController`로 SIGTERM·SIGINT를 받아 폴링 루프를 끝내고 종료 코드 0으로 나간다.
- Turborepo에 `build` 태스크(`outputs: ["dist/**"]`)를 더해 `turbo run build`로 웹을 빌드했다. `typecheck`는 5개 패키지 모두 통과했다.

## 막힌 곳과 우회법 요약

| 막힌 곳                                              | 우회                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------- |
| `.inputValidator()`가 1.169.5에 없음                 | `.validator()`를 쓴다                                      |
| 검증 함수 인자가 `unknown`이면 입력 타입이 안 이어짐 | zod 같은 Standard Schema를 검증기로 넘긴다                 |
| `nodenext`로는 웹 앱 typecheck 실패                  | `apps/web`만 `module: esnext`, `moduleResolution: bundler` |
| `@stylexjs/unplugin`의 `vite()`가 `any` 반환         | `PluginOption`을 반환하는 함수 타입으로 단언               |
| oxfmt가 `routeTree.gen.ts`를 포맷하려 함             | `.oxfmtrc.json` `ignorePatterns`에 추가                    |
| StyleX가 `data-*` 상태 선택자를 쓰기 어려움          | UI SDK `className` 상태 함수로 StyleX 클래스 선택          |
| dev에서 StyleX CSS가 자동으로 안 붙음                | 루트 셸 `<head>`에 dev 전용 `/virtual:stylex.css` 링크     |
| pnpm `minimumReleaseAge`가 새 UI SDK 베타를 막음     | 하루 기다리거나 `minimumReleaseAgeExclude`에 버전 명시     |
| JSON 메시지는 ICU 인자 타입을 못 잡음                | TS 메시지 파일 또는 Paraglide                              |

## 남은 위험

- **배포 형태(ADR 0005)**: Node는 `node_modules` 안의 `.ts` 파일에 타입 스트리핑을 하지 않는다. 지금 worker는 워크스페이스 안이라 돌지만, npm 패키지로 배포하면 worker와 공유 패키지를 JS로 빌드하는 단계가 필요하다. 웹은 이미 `dist`로 빌드된다. 릴리스 티켓에서 worker 번들러(Rolldown 등)를 정해야 한다.
- **서버 바인딩**: `srvx`가 기본으로 모든 인터페이스에서 듣는다. 셀프호스팅 설정에서 바인딩 주소를 정해야 한다(webhook을 밖에 여는 방식은 ADR 0005대로 운영자가 고른다).
- **`packages/ui` 밖 색 값 금지**: oxlint에는 StyleX 규칙이 없다. 0003의 "밖에서 색 값을 쓰면 실패" 조건은 별도 검사(oxlint JS 플러그인, 커스텀 스크립트 등)로 만들어야 한다.
- **UI SDK 베타**: 0.1.0-beta.7이 이미 나왔다. 버전 고정과 `packages/ui` 격리(ADR 0003)가 그대로 필요하다.
- `@tanstack/react-start`가 RSC를 쓰지 않아도 `@tanstack/react-start-rsc`를 전이 의존성으로 설치한다. 기능에는 영향이 없다.
- 확인하지 않은 것: HMR 중 StyleX CSS 갱신의 세부 동작, 다크 모드 테마(`createTheme`), 실제 Linear webhook 서명 검증, CI(ubuntu)에서의 웹 빌드.
