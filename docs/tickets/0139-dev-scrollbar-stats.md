---
status: doing
blocked_by: []
---

# 0139 pnpm dev 에서 스크롤바가 다시 생기고 Stats 화면이 이상함

## 목표

운영자 보고(2026-11-20, develop 의 `pnpm dev`): "스크롤바가 다시 생기고 Stats 화면이 이상하다", "Stats 는 원래 행으로 놓기로 했는데 열로 보인다", "0.1.0 에서는 스크롤도 Stats 도 괜찮다". 원인을 찾아 고친다. 개발 전용 도구(TanStack Query devtools 등)가 개발 빌드에서도 제품 화면을 가리지 않게 한다.

## 원인

개발 서버의 StyleX CSS 가 처음 연 화면의 규칙만 담고, 레일로 옮겨 간 화면의 규칙을 받지 못했다.

- 개발 빌드는 루트 문서 `<head>`에 `/virtual:stylex.css` 링크 하나만 단다(research 0001 스파이크 때부터, 커밋 3843e2c·dece34f). 이 CSS 는 그 순간까지 변환한 모듈의 규칙만 담는다. 화면 route 는 코드 분할돼 처음 연 화면 밖의 화면 코드는 레일로 옮겨 갈 때 처음 변환된다.
- `@stylexjs/unplugin`은 새 규칙이 생기면 `stylex:css-update` 이벤트를 보내고, 그 이벤트를 받아 CSS 를 다시 읽는 런타임 스크립트(`/@id/virtual:stylex:runtime`)를 `transformIndexHtml`로 붙인다. TanStack Start 는 `index.html`을 쓰지 않아 이 스크립트가 붙지 않았다. 그래서 새 규칙을 아무도 받지 않았다.
- 결과: 개발 서버를 띄우고 Dashboard 를 연 뒤 레일로 Stats 에 가면 Stats 화면의 규칙 23개가 빠진다. 숫자 카드 네 칸 격자(`figures`), 차트·실패 이유 두 칸 격자(`charts`), 최대 폭(`statsPageWidth`)이 없어 카드가 한 줄에 하나씩 세로로 쌓이고 페이지가 길어져 스크롤바가 생긴다. Tickets(4개 빠짐)는 목록만 스크롤하는 틀이 빠져 머리·필터·열 이름까지 함께 스크롤되고(ADR 0010 Tickets 규칙 위반), Runners(5개)·Runs(1개)도 일부 규칙이 빠진다. 주소를 직접 열거나 새로 고치면 그 화면 규칙이 담긴 CSS 를 새로 받아 바르게 보여, 같은 화면이 때에 따라 다르게 보였다.

## 확인한 방법

같은 방식(`pnpm dev`, 같은 시드, 1280×900, 개발 서버를 새로 띄운 뒤 `/`에서 레일 링크를 차례로 누름)으로 띄워, 화면에 쓰인 StyleX 클래스 중 붙은 CSS 규칙이 없는 것의 수를 셌다.

| 띄운 것                              | Tickets | Runs | Runners | Stats | Settings | Stats 모양       |
| ------------------------------------ | ------- | ---- | ------- | ----- | -------- | ---------------- |
| v0.1.0 태그, `pnpm dev`              | 7       | 1    | 6       | 22    | 0        | 카드 세로로 쌓임 |
| 623f66f(0123 전 develop), `pnpm dev` | -       | -    | -       | 빠짐  | -        | 카드 세로로 쌓임 |
| develop 9ea69ed, `pnpm dev`          | 4       | 1    | 5       | 23    | 0        | 카드 세로로 쌓임 |
| develop 9ea69ed, 프로덕션 빌드·start | 0       | 0    | 0       | 0     | 0        | 네 칸 한 줄      |
| 이 브랜치, `pnpm dev`                | 0       | 0    | 0       | 0     | 0        | 네 칸 한 줄      |

- 주소를 직접 열면 v0.1.0·develop 개발 서버 모두 Stats 가 바르게 보인다.
- 그래서 v0.1.0→develop 사이의 회귀가 아니다. 같은 `pnpm dev`로 띄우면 v0.1.0 도 똑같이 깨진다. 0.1.0 이 괜찮아 보인 것은 출시판(데스크톱 앱, 프로덕션 빌드)을 본 것이라, CSS 를 한 파일로 미리 만드는 프로덕션 빌드에서는 이 문제가 없다. bisect 할 좋은 커밋이 없어 하지 않았다. 원인은 개발 빌드에 링크만 달고 런타임 스크립트를 달지 않은 스파이크 때 결정(research 0001 "dev에서 StyleX CSS가 자동으로 안 붙음 → 루트 셸 `<head>`에 dev 전용 링크")이다.
- 예전에 고친 스크롤 문제와의 관계: 저장소 이력에 개발 서버 스크롤바를 고친 커밋은 없다. "다시"는 같은 화면이 새로 고침 여부에 따라 바르게도(직접 열기) 깨지게도(레일 이동) 보여 생긴 인상으로 본다. 깨질 때 어긋나는 규칙은 ADR 0010(Tickets 목록만 스크롤)과 DESIGN.md(`ScreenLayout` 본문만 스크롤, Stats 숫자 카드 네 칸)이 정한 그대로이고, 고친 뒤 그 규칙대로 보인다.

## TanStack Query devtools

- 0123 부터 개발 빌드에 devtools 단추가 왼쪽 아래(`bottom-left`)에 늘 떠 있었다. 1280 폭에서 단추(16,844, 40×40)가 레일 맨 아래 Ganger 표시를 그대로 덮었다(0129 가 본 200% 레일 겹침과 같은 단추). 야자수 그림이 레일 항목처럼 보였다.
- 기본으로 그리지 않는다. 켜면 떠 있는 단추 없는 `ReactQueryDevtoolsPanel`을 화면 아래 절반에 그리고, 패널의 닫기는 끄기와 같다. 켜고 끄는 곳은 `/__dev` 개발 도구 페이지의 **Query devtools 켜기·끄기** 단추다(`BroadcastChannel`로 열린 앱 탭에 전한다). 단추는 앱 탭의 실제 표시 상태를 `aria-pressed`로 보인다. 오른쪽 아래 칩 묶음에 칩을 더하면 묶음이 넓어져 화면 끝 내용을 더 가려(interface-review) 칩으로 두지 않았다. `pnpm dev` 없이 웹만 띄웠을 때는 콘솔에서 `dispatchEvent(new Event("ganger:toggle-query-devtools"))`. README Development 절에 적었다.
- 프로덕션 빌드(`apps/web/dist`)에 `ReactQueryDevtools`·`query-devtools`·`toggle-query-devtools`·`virtual:stylex` 문자열이 없는 것을 빌드 결과로 확인했다.

## 고친 것

- `apps/web/src/routes/__root.tsx`: 개발 빌드의 `<head>`에 `/virtual:stylex.css` 링크와 함께 StyleX 런타임 스크립트(`/@id/virtual:stylex:runtime`)를 단다. 스크립트가 CSS 를 `<style>`로 받아 두고 새 규칙 이벤트마다 다시 읽는다. 링크는 hydration 이 어긋나지 않게 그대로 두고 스크립트가 끈다.
- `apps/web/src/query/devtools.tsx`, `devtools-toggle.ts`: devtools 를 루트에서 떼어 켜기 이벤트로만 그린다.
- `demo/src/client/prefill.ts`, `demo/src/dev-page.ts`, `demo/src/values.ts`: 개발 도구 페이지 단추와 앱 탭 사이의 `BroadcastChannel` 다리. 앱은 표시 상태를 `ganger:query-devtools-state` 이벤트로 알린다.
- `e2e/src/web-server.ts`: 시험 서버에 `hmr` 선택값(기본 꺼짐 그대로).

## 완료 조건

- [x] `pnpm dev`를 새로 띄워 Dashboard 에서 레일로 옮겨 간 Tickets·Runs·Runners·Stats·Settings 에 빠진 StyleX 규칙이 없다(1280·1440·400).
- [x] Stats 가 1280·1440 에서 숫자 카드 네 칸 한 줄, 차트·실패 이유 두 칸으로 보인다. Tickets 는 목록만 스크롤한다.
- [x] Query devtools 가 기본으로 화면을 가리지 않고, 개발 도구 페이지에서 켜고 끈다. 패널로 닫아도 떠 있는 단추가 남지 않는다.
- [x] 브라우저 시험 `e2e/src/dev-styles.test.ts`: 개발 서버(HMR 켬)에서 `/ds`를 연 뒤 앱 안에서 `/onboarding`으로 옮겨도 화면의 StyleX 클래스마다 규칙이 있다. 고치기 전 코드에서는 6개가 빠져 실패하는 것을 확인했다.
- [x] 데모 시험 `demo/src/dev.test.ts` 'Query devtools 는 기본으로 그리지 않고, 개발 도구 페이지에서 켜고 끈다': 처음에는 패널이 없고 칩 묶음은 두 개, `/__dev` 단추의 `aria-pressed`가 `false`. 누르면 앱 탭에 패널이 붙고 `true`, 떠 있는 단추는 없다. 패널의 닫기를 누르면 패널이 빠지고 단추가 `false`, 떠 있는 단추는 여전히 없다. `@tanstack/react-query-devtools`는 `NODE_ENV`가 `development`일 때만 그려, 이 시험만 개발 서버를 `NODE_ENV=development`로 띄운다(vitest 는 `test`를 물려준다). 개발 서버가 첫 화면 뒤 의존성을 다시 최적화하며 한 번 새로 고치면 앱 탭 상태가 사라져, 꺼져 있으면 다시 누른다.
- [x] 프로덕션 묶음에 devtools 와 개발 CSS 런타임이 없다.

## 남은 것

- 개발 도구 칩 묶음(0047 부터, 이 티켓에서 바꾸지 않음)은 오른쪽 아래에 떠서 좁은 폭에서 스크롤 끝 내용 일부(400 폭 Runners 마지막 줄, Runs 의 PR 열 이름, 1280 Settings MCP 행 모서리)를 가린다. 개발 전용이라 따로 다룬다.

- 쿠키 없는 첫 방문 hydration 불일치(0129 에서 넘어온 개발 서버 전용 문제)는 그대로다. 이 티켓의 원인과 다르다.
