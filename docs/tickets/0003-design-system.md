---
status: todo
blocked_by: [0001, 0002]
---

# 간단한 디자인 시스템

## 목표

확정한 시안을 바탕으로, 이후 기능 개발에서 품질이 흐트러지지 않게 할 최소한의 디자인 시스템을 `packages/ui`에 만든다.

## 범위

- 토큰: StyleX `defineVars`로 색(OKLCH, 라이트·다크), 간격, 타이포, 반경, 그림자, 모션
- 컴포넌트: Button, Badge(런 상태·결과), Table, Card, Tabs, Dialog, Menu/Select, Tooltip, Toast, Input. 동작은 UI SDK(`@ui-sdk/react`, 버전 고정), 스타일은 StyleX
- UI SDK 사용은 `packages/ui` 안에만 둔다(ADR 0003)
- `packages/ui/DESIGN.md`: 어떤 컴포넌트와 변형을 언제 쓰는지, 어떤 토큰을 쓸 수 있는지(emil-design-system-docs 방식)
- `apps/web`의 `/ds` 라우트에서 토큰과 컴포넌트를 미리 본다
- `packages/ui` 밖에서 색 값을 직접 쓰면 린트나 CI에서 실패한다

## 완료 조건

- `/ds`에서 모든 컴포넌트를 라이트·다크로 확인할 수 있다
- 밖에서 색 값을 직접 쓴 예제가 검사에서 실패한다
