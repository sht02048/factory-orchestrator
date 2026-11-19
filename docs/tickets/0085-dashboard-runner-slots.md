---
status: done
blocked_by: []
---

# 0085 Dashboard Runners를 칸으로 다시 그리기

## 목표

Dashboard 오른쪽 Runners 구역에서 러너마다 쓰는 자리와 빈자리를 한눈에 정확히 읽게 한다.

## 배경

운영자 결정(2026-11-19, 시안 U3의 A). 지금 Runners 구역의 capacity 막대(`CapacityBar`)는 2/3을 정확히 읽을 수 없다. 자리 하나를 칸 하나로 그린다. capacity 한 단위를 화면 문구에서는 "자리"라고 쓴다(GLOSSARY Capacity).

## 범위

- **행.** 상태 점 · 러너 이름 · 칸(`■■□`) · 숫자 `2/3`(tabular-nums). 행은 한 줄이다. Offline이 얼마나 됐는지는 행 대신 아래 문제 상자의 이름 옆에 둔다.
- **칸.** 칸 하나가 자리 하나다. 쓰는 자리는 채운 칸이다. Online이면 초록(progress), 문제 있는 러너(Runner Issue·Offline)면 빨강(problem)이다. 빈자리는 채움 없이 중립 회색 테두리(`borderStrong`)만 그린다.
- **화면 읽기.** 칸 묶음은 "3자리 중 2자리 사용" 같은 이름 하나로 읽고 칸 각각은 숨긴다.
- **구역 머리.** "새 런 받을 자리 N"을 한 줄로 둔다. N은 Online이고 문제 없는 러너의 빈자리 합이다.
- **자리가 많을 때.** 자리가 8보다 많으면(`CAPACITY_CELLS_MAX`) 칸 없이 숫자만 보인다. 오른쪽 열 폭에서 칸이 줄을 넘지 않게 하는 기준이다.
- **문제 이유.** 지금처럼 아래 문제 상자가 맡는다.
- **공용 컴포넌트.** `packages/ui`에 `CapacityCells`를 더하고 `/ds`에 미리보기를 붙인다. 이름에 Slot을 쓰지 않는다(GLOSSARY Capacity의 _Avoid_).
- Runners 목록의 `CapacityBar`는 바꾸지 않는다. 0086이 같은 화면을 함께 고쳐 겹치고, 운영자는 Dashboard만 지적했다. 목록도 칸으로 바꿀지는 0086 뒤 후속으로 본다.
- 사용량 숫자 줄은 0086이 더한다. 이 티켓은 넣지 않는다.
- 0074 검사(토큰 import·HTML 요소·길이)와 ADR 0010 색 규칙을 지킨다. 화면 문구는 `apps/web/messages/ko/home.json`, `ds.json`에 둔다.

## 완료 조건

- `CapacityCells` 시험: 칸 수·채운 칸·빈칸, 화면 읽기 이름, 칸 각각 숨김, tone, 8 초과면 숫자만, 쓰는 자리가 capacity보다 많을 때(`packages/ui/src/components.test.tsx`).
- Dashboard 시험: 행이 칸과 숫자로 보이고 문제 러너는 빨간 칸, 구역 머리의 새 런 받을 자리 수, Offline 기간이 문제 상자로 옮겨 간 것(`apps/web/src/home/home-screen.test.tsx`).
- 스크린숏: Dashboard 1280px(정상·꽉 참·문제 러너가 함께 보이는 가짜 데이터), `/ds` 칸 미리보기.
