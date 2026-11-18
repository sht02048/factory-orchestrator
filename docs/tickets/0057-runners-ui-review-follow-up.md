---
status: todo
blocked_by: []
---

# 0057 Runners UI 리뷰 후속

## 목표

Runners의 잘린 이름을 끝까지 볼 수 있게 하고, Home에서 고른 러너로 포커스를 옮긴다.

## 배경

UI 리뷰 판정은 Approve with changes였다.

## 범위

### 고칠 것(Should fix)

1. **잘린 확인 항목 이름.** `runners-screen.tsx`의 `checkName`이 `nowrap` + 말줄임이다. 문구가 "GitHub push 권한: {project}"라 320px 카드에서 프로젝트마다 다른 끝부분이 잘려 어떤 프로젝트가 깨졌는지 알 수 없다. `hint`처럼 `overflowWrap: "anywhere"`로 줄을 바꾼다. 러너 이름 `h2`도 잘리는데 전체를 볼 길이 없다. 줄바꿈을 허용하거나 `title`을 단다.
2. **고른 러너로 포커스.** Home의 Runner Issue 카드에서 오면(`sel`) `scrollIntoView`만 부른다. 카드 `li`에 `tabIndex={-1}`을 주고 `focus({ preventScroll: true })`도 부른다.

### 하면 좋은 것(Nits)

- 러너가 0대면 본문이 비고 안내는 부제목 한 줄뿐이다. 빈 상태 블록을 둔다.
- 런 행에서 누를 수 있는 곳이 티켓 키 글자뿐이다. 0050 5번(행 hover)을 정할 때 행 전체를 링크로 할지 함께 정한다.

## 완료 조건

- 긴 프로젝트 이름의 확인 항목이 잘리지 않는다는 시험.
- `sel`로 들어오면 그 러너 카드에 포커스가 간다는 브라우저 시험.
