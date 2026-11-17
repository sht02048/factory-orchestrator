# 스타일은 StyleX, 컴포넌트 동작은 UI SDK

Tailwind 대신 StyleX로 스타일을 쓰고, 키보드·포커스·팝업·ARIA 같은 동작은 vercel-labs/ui(UI SDK, `@ui-sdk/react`)에 맡긴다. StyleX는 토큰(`defineVars`)과 스타일이 타입으로 검사돼 "타입을 빡빡하게" 가져간다는 원칙과 맞고, UI SDK는 스타일 없는 헤드리스 라이브러리라 StyleX와 역할이 겹치지 않는다. 디자인 시스템은 `packages/ui`에 두고, 그 밖에서는 색 값을 직접 쓰지 않는다.

## Consequences

UI SDK는 도입 시점(2026-11)에 `0.1.0-beta`라 API가 바뀔 수 있다. 버전을 고정하고, UI SDK 사용은 `packages/ui` 안에 가둬 바뀌어도 고칠 곳이 한 군데이게 한다.
