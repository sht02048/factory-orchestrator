---
status: todo
blocked_by: []
---

# 0051 Run 상세 UI 리뷰 후속

## 목표

Run 상세에서 답·거절·취소를 보낸 뒤에도 포커스와 결과 안내가 남게 하고, 로그와 실패 문구를 읽기 쉽게 한다.

## 배경

UI 리뷰(0050과 같은 방식) 판정은 Blocked였다. 보내기가 성공하면 다시 읽은 데이터로 카드나 버튼이 통째로 빠져 포커스가 `body`로 떨어지고 성공 문구가 한 번도 보이지 않는다. Home(0050 1·2번)과 같은 패턴이다.

## 범위

### 반드시(Blocking)

1. **답·거절 뒤 카드가 사라진다.** `run-detail-screen.tsx`의 `InputBlock`은 `input.answered`·`input.denied`면 `null`을 돌려준다. 라우트(`runs_.$runId.tsx`)의 `onAnswer`·`onDeny`는 다시 읽기까지 기다리므로, `QuestionForm`의 `setSubmit({kind:"sent"})`와 `question.sent`·`permission.denied` 문구가 그려지기 전에 카드가 빠진다. 보낸 뒤에도 결과 카드를 남겨 `role="status"`로 알리거나, 카드를 빼기 전에 포커스를 제목(`tabIndex={-1}`)이나 지나온 일로 옮긴다.
2. **취소 확인 뒤 트리거가 사라진다.** 다시 읽은 뒤 `cancelPending`이면 `CancelRun` 전체가 빠진다. 트리거 자리에 비활성 "취소 중" 버튼을 남기거나 포커스를 상태 줄로 옮기고 상태 줄을 `role="status"`로 둔다.

### 고칠 것(Should fix)

3. **실패 문구.** `actionFailed`를 `Text variant="body"`·`"meta"`로만 보인다. Home·Tickets·Settings처럼 `role="alert"`와 `colors.problem`을 쓴다.
4. **로그 꼬리.** 최대 200줄을 `maxHeight: 480`·`overflowY: auto`인 `<pre>`에 넣어 가장 오래된 줄부터 보인다. 마운트할 때와 줄이 바뀔 때 맨 아래로 스크롤한다. `tabIndex={0}`, `role="region"`, `aria-label`을 붙여 키보드로 스크롤할 수 있게 한다.
5. **"새로 받기" 반응.** `onRefreshLog`가 `void`를 돌려주고 실패를 삼킨다. `Promise`를 돌려주게 바꿔 받는 동안 비활성과 "받는 중"을, 실패하면 문구를 보인다.

### 하면 좋은 것(Nits)

- 제출 버튼 정렬 `submitOffset: paddingTop: 28`이 매직 넘버다. 라벨을 Field 밖으로 빼 입력칸과 버튼만 한 줄에 `alignItems: center`로 둔다.
- 브레드크럼 "‹ Runs" 링크의 누르는 영역을 `paddingBlock`이나 `minHeight`로 넓힌다.

## 완료 조건

- 답·거절·취소를 키보드로 보낸 뒤 포커스가 `body`가 아니고, 결과 문장이 `role="status"` 안에 있거나 포커스를 받는다는 브라우저 시험.
- 실패 문구가 `role="alert"`라는 시험.
- 로그를 열면 마지막 줄이 보인다는 시험.
- 새 문구는 `apps/web/messages/ko/`의 메시지 파일에 둔다(ADR 0005).
