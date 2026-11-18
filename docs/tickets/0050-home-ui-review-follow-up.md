---
status: doing
blocked_by: []
---

# 0050 Home UI 리뷰 후속

## 목표

Home을 키보드·화면 읽기·터치로 써도 깨지지 않게 하고, "지금 일어나는 일"이 이름대로 지금을 보이게 한다.

## 배경

0049b 뒤 Home 화면(`apps/web/src/home/home-screen.tsx`)과 그 화면이 쓰는 `packages/ui` 컴포넌트를 UI 리뷰로 봤다. 판정은 Blocked였다. 키보드로 답·거절 폼을 열면 포커스가 사라지기 때문이다. 나머지는 공용 컴포넌트에서 물려받은 접근성 문제와 갱신·좁은 화면 문제다.

## 범위

### 반드시(Blocking)

1. **답·거절 폼의 포커스.** "직접 답하기"(`home-screen.tsx` `QuestionBody`)와 "거절"(`PermissionBody`)은 누르면 버튼을 DOM에서 지워 포커스가 `body`로 떨어진다. 연 폼을 닫을 방법도 없다.
   - 폼을 열면 입력칸으로 포커스를 옮긴다.
   - 폼에 ghost "취소" 버튼을 두고 Escape로도 닫는다. 닫으면 포커스를 트리거 버튼으로 돌린다.

### 고칠 것(Should fix)

2. **성공을 알린다.** 답·거절이 성공하면 폼이 "답을 남겼어요"·"거절을 남겼어요" 문장으로 바뀌지만 화면 읽기에 알리지 않고 포커스도 사라진다. 이 문장을 `role="status"`로 두거나 문장으로 포커스를 옮긴다.
3. **입력칸 확대.** `packages/ui/src/components/field.tsx`의 `Input`이 `@media (min-width: 900px)`에서 14px로 줄어 iPad Safari가 포커스 때 확대한다. 조건을 `@media (pointer: fine)`으로 바꾼다. 공용 컴포넌트라 모든 화면에 적용된다.
4. **터치 대상.** `packages/ui/src/components/button.tsx`의 버튼 높이가 32px(`size.control`)이다. 보이는 크기는 두고 `@media (pointer: coarse)`에서 의사 요소로 누르는 영역을 44×44px까지 넓힌다. 버튼 모양을 입힌 링크(`buttonStyles`)도 같다.
5. **흐름 행의 hover.** "지금 일어나는 일" 행은 누를 수 없는데 `Row`(`card.tsx`)의 `:hover` 면이 생긴다. 흐름 행을 Run 상세 링크(`/runs/:id?ws=`)로 바꾼다. 링크로 하지 않으면 `Row`가 hover 면을 끌 수 있게 한다.
6. **저절로 갱신.** Home은 로더 한 번과 답·거절 뒤 `router.invalidate()`로만 바뀐다. 새 손댈 일, 새 사건, "N분 전"이 새로 고치기 전까지 멈춰 있다. 문서가 보일 때 Home 로더를 주기적으로 다시 읽거나 서버 이벤트로 갱신한다. 갱신할 때 카드가 늘거나 줄어 레이아웃이 튀지 않는지 함께 본다. 주기나 방식(폴링·SSE)이 되돌리기 어려운 결정이면 ADR로 남긴다.
7. **좁은 화면.** `layout.tsx`의 `pageHead`에 `flexWrap`이 없어 개수 타일 3개가 제목·요약을 짓누른다. 줄바꿈을 허용한다. Home 페이지 좌우 여백(`space.s8`)을 좁은 화면에서 `space.s4`로 줄인다.

### 하면 좋은 것(Nits)

- 흐름 카드가 `Card label`의 `section aria-label`과 같은 글의 `h2`를 함께 가져 제목을 두 번 읽는다. `aside` 안에 `section`이 겹친다. 이름은 한 곳에서만 준다(`aria-labelledby` 등).
- 선택지를 누르면 모든 선택지가 똑같이 비활성이 된다. 누른 선택지에만 "보내는 중…"을 보이고, 보내는 동안 "직접 답하기"도 막는다.
- `Button`·`Row`의 `:hover` 배경을 `@media (hover: hover)`로 묶어 터치 뒤 hover 면이 남지 않게 한다.
- `Button`의 누름 축소(`scale(0.97)`)를 `prefers-reduced-motion: reduce`에서 끈다.

## 범위 밖

- Home 구조와 문구 바꾸기(ADR 0010).
- 다른 화면의 같은 문제. 3·4번과 Nits의 공용 컴포넌트 수정은 모든 화면에 적용되지만, 다른 화면만의 문제는 따로 티켓을 만든다.

## 완료 조건

- 키보드로 "직접 답하기"·"거절"을 열면 입력칸에 포커스가 가고, 취소·Escape로 닫으면 트리거 버튼에 포커스가 돌아온다는 브라우저 시험.
- 답·거절이 성공하면 결과 문장이 `role="status"` 안에 있거나 포커스를 받는다는 시험.
- `Input` 글자 크기가 폭이 아니라 포인터 조건으로 바뀐다는 확인(스타일 시험 또는 브라우저 시험).
- 흐름 행이 Run 상세 링크이거나, hover 면이 없다는 시험.
- Home이 새로 고치지 않아도 새 손댈 일을 보인다는 시험.
- 375px 폭에서 Home 머리 영역이 넘치지 않는 스크린숏을 PR에 붙인다.
- 새 화면 문구는 메시지 파일(`apps/web/messages/ko/home.json`)에 둔다(ADR 0005).
