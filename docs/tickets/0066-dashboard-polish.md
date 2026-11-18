---
status: todo
blocked_by: []
---

# 0066 Dashboard 다듬기

## 목표

0060 리뷰에서 막지 않는 항목으로 남긴 것을 고친다.

## 범위

- **질문 레이어 Enter:** 선택지(라디오)에서 Enter를 누르면 폼이 바로 제출된다. 고른 뒤 "보내기"로만 보낸다는 0059 결정과 어긋난다. 선택지에서 Enter는 고르기만 하고, 직접 쓰기 칸에서는 ⌘ Enter로만 보낸다.
- **거절 오류가 남음:** 거절에 실패한 뒤 레이어를 닫았다 열어도 예전 오류 문구가 남는다. 다시 열면 오류를 지운다.
- **모든 Workspace 보기:** In progress와 함께 Done today도 숨는다. 모든 Workspace 보기에서 무엇을 보일지 정하고(Done today는 보이는 쪽을 권한다), Workspace 이름을 행에 보인다.
- **branded type:** 새 `DoneRun` 타입과 `runHref`가 런 ID와 티켓 키를 맨 `string`으로 받는다. CODING_STANDARDS.md "ID는 branded type으로 쓴다"대로 바꾼다.
- **375px Done today 키 말줄임:** Human Check 같은 긴 알약 옆에서 키가 "ACM…"으로 줄어든다. 키가 줄지 않게 하고 알약이나 시간 배치를 고친다.

## 완료 조건

- 선택지에서 Enter를 눌러도 보내지 않는다는 브라우저 시험.
- 다시 연 레이어에 예전 오류가 없다는 시험.
- 모든 Workspace 보기의 구역 표시 시험.
- 375px에서 키가 다 보이는 스크린숏을 PR에 붙인다.
