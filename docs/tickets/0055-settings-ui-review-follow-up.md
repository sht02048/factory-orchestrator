---
status: todo
blocked_by: [0050]
---

# 0055 Settings UI 리뷰 후속

## 목표

Settings에서 저장·더하기·빼기 뒤 포커스를 잃지 않고, 입력 중에 겁주는 오류와 비밀값 칸의 잘못된 자동 완성을 없앤다.

## 배경

UI 리뷰 판정은 Approve with changes였다. 3번과 Nits는 `packages/ui`의 `Input` props를 넓혀야 해서, 같은 파일을 고치는 0050 뒤에 한다.

## 범위

### 고칠 것(Should fix)

1. **프로젝트 더하기·빼기 뒤 포커스.** `settings-screen.tsx`에서 "더하기"가 성공하면 다시 읽은 뒤 그 버튼이 "빼기" 대화상자 트리거로 바뀌고, 빼기도 반대로 바뀐다. 두 경우 모두 포커스가 `body`로 떨어진다. 버튼 하나를 같은 자리에 두고 글과 동작만 바꾸거나, 성공 뒤 행으로 포커스를 옮긴다.
2. **이른 검증.** 이름·최대 실행 시간·동시 실행 수 오류(`nameInvalid`, `maxRunInvalid`, `capacityInvalid`)를 렌더마다 계산해, 값을 지우는 순간 빨간 오류가 뜬다. blur나 제출 때 처음 검증하고 그 뒤로는 바뀔 때마다 검증한다.
3. **비밀값 자동 완성.** API 키·webhook secret·GitHub 토큰 칸이 `autoComplete="new-password"`라 브라우저·비밀번호 관리자가 새 비밀번호 만들기를 권한다. `autoComplete="off"`와 비밀번호 관리자 무시 속성(`data-1p-ignore`, `data-lpignore`)을 쓴다. `Input`이 data 속성을 넘기도록 한다.
4. **저장하지 않은 값.** `ItemPanel`이 `key`로 다시 만들어져 왼쪽 항목을 바꾸면 입력하던 값이 말없이 사라진다. 바뀐 폼이 있으면 항목을 바꾸기 전에 확인을 받거나, 적어도 "저장하지 않은 변경" 표시를 둔다.

### 하면 좋은 것(Nits)

- 분·동시 실행 수 칸에 `inputMode="numeric"`을 준다(`Input`에 prop을 더한다).
- 본문 안 "Runners로 가기" 링크에 기본 밑줄을 두고(WCAG 1.4.1), 일반 `<a href>` 대신 라우터 `Link`를 쓴다.
- "다시 확인" 버튼이 기다리는 동안 "확인하는 중"으로 글을 바꾼다.

## 완료 조건

- 프로젝트를 더하거나 뺀 뒤 포커스가 `body`가 아니라는 브라우저 시험.
- 값을 지우기만 해서는 오류가 보이지 않고 blur 뒤에 보인다는 시험.
- 비밀값 칸이 `new-password`가 아니라는 시험.
- 새 문구는 메시지 파일에 둔다(ADR 0005).
