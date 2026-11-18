---
status: todo
blocked_by: []
---

# 0052 온보딩 UI 리뷰 후속

## 목표

온보딩 단계를 옮기거나 처음 무언가를 만들 때 키보드 포커스와 안내가 끊기지 않게 한다.

## 배경

UI 리뷰 판정은 Blocked였다. 단계를 옮기거나 처음 연결·러너·Workspace를 만들면 누른 요소가 DOM에서 빠져 포커스가 `body`로 떨어진다.

## 범위

### 반드시(Blocking)

1. **단계 이동.** `onboarding-screen.tsx` 단계 목록은 누른 단계가 지금 단계가 되면 `<button>`이 `<span aria-current="step">`으로 바뀐다. "이전"으로 0번 단계에 가도 버튼이 빠진다. "다음"을 누르면 새 단계가 열렸다는 안내가 없다. 단계가 바뀌면 본문 제목에 `tabIndex={-1}`을 주고 포커스를 옮긴다.
2. **처음 만들기.** `TrackerStep`은 연결이 0개에서 1개가 되면, `RunnerStep`은 러너가 0대에서 1대가 되면 트리 모양이 바뀌어 폼이 새로 마운트된다. `CreateWorkspaceForm`은 성공하면 `ProjectsPanel`로 통째로 바뀌고 토스트도 없다. 0개일 때도 같은 트리(`<ul><li>`)를 쓰고, 성공 뒤 새 카드 제목이나 다음 행동으로 포커스를 옮긴다. `CreateWorkspaceForm`도 성공을 토스트로 알린다.

### 고칠 것(Should fix)

3. 완료한 단계는 `aria-hidden` 체크 SVG뿐이라 화면 읽기에 번호도 완료도 읽히지 않는다. 화면 밖 "완료" 문구를 붙인다.
4. 비활성 "다음" 버튼과 막은 까닭(`nextLocked`) 문구를 `aria-describedby`로 잇는다.
5. Mapping 상태 안내의 `role="status"`가 `<p>`와 `<div>` 사이에서 통째로 바뀐다. 감싸는 status 요소 하나를 두고 안쪽만 바꾼다.

### 하면 좋은 것(Nits)

- 지금 단계 `stepCurrent`의 `fontWeight: semibold`가 단계를 옮길 때마다 글자 폭을 바꾼다. 굵기는 고정하고 색·배경만 바꾼다.
- `stepButton`의 hover를 `@media (hover: hover)`로 묶는다(0050과 같은 원인).

## 완료 조건

- 키보드로 단계를 옮기면 새 단계 제목에 포커스가 간다는 브라우저 시험.
- 첫 연결·첫 러너·Workspace를 만든 뒤 포커스가 `body`가 아니라는 시험.
- 완료한 단계가 접근성 이름에 "완료"를 갖는다는 시험.
- 새 문구는 메시지 파일에 둔다(ADR 0005).
