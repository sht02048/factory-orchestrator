---
status: done
blocked_by: [0152, 0149]
---

# 0153 화면에 움직임 적용

## 목표

[0152](0152-motion-primitives.md)의 공용 동작을 실제 화면에 적용해, 운영자가 상태가 바뀐 곳을 눈으로 따라가게 한다. 값과 원칙(M1~M5)은 0152를 따른다.

## 할 일

1. Dashboard: 카드 칸 옮기기(`MotionScope move="card"`), 남은 카드 메우기, 도착 비추기.
2. To do: 항목 들어오기·빠지기.
3. 상태 알약: 목록에서 상태가 바뀌면 `StatusPill changeMotion`으로 표시한다.
4. Runs: 행 생기기·자리 바꾸기.
5. Run 상세 타임라인: 새 줄(`MotionList enter="rise"`). 줄이 자주 붙는 로그는 움직이지 않는다.
6. 대화상자·Sheet 닫기: 0152가 `Dialog`·`Sheet` 안에 넣어 화면 코드는 바꾸지 않는다. 각 화면에서 닫은 뒤 포커스와 다음 동작이 맞는지 확인한다.
7. 탭·필터·Workspace를 바꿀 때는 `MotionList resetKey`로 움직이지 않게 한다.

## 완료 조건

- 시험: 화면별로 첫 렌더 무움직임, SSE로 바뀐 항목만 움직임, 필터 바꿀 때 무움직임, reduced-motion.
- 브라우저 시험을 CPU 부하에서 5회 돌려 모두 통과한다(부하 프로세스 최대 4개).
- 화면 변경 있음. DB 변경 없음. two-way.
