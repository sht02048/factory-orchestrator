---
status: done
blocked_by: []
---

# 0049a 리디자인 기반: 토큰·상태 알약·버튼·카드, 시간 표기 함수, 메시지 낱말

묶음 티켓 [0049](0049-ui-redesign.md)의 첫 하위 티켓이다. 다른 하위 티켓(0049b~e)이 모두 이것을 쓴다.

## 목표

[ADR 0010](../adr/0010-ui-words-and-visual-rules.md)의 규칙을 화면이 따를 수 있게 `packages/ui`와 공용 함수·메시지를 먼저 바꾼다. 화면 레이아웃 개편은 하지 않고, 지금 화면이 깨지지 않게 기존 사용처만 새 컴포넌트로 옮긴다.

## 범위

- **토큰.** 색 의미 여섯 가지(ADR 0010 5번): `answer`(보라), `check`(노랑, 주황에서 바꿈), `problem`(빨강, `failed`에서 바꿈), `progress`(초록, `online`에서 바꿈), `merged`(파랑), `idle`(회색)과 각 `Soft`. 면 토큰 `bgCard`·`bgCardHover`·`bgControl`·`bgControlHover`. 둥글기 `card 12`·`control 8`·`pill 6`·`full`(`sm`·`md`는 뺐다).
- **상태 알약 `StatusPill` 하나.** 상태 값(런 상태, 요약 결과, 러너 Online·Offline, 손댈 일 종류)을 받아 색을 고른다(`statusTone`). `Status`·`Dot`은 뺐다. 웹은 `useStatusName`(`apps/web/src/status.ts`)으로 이름을 가져온다.
- **버튼 위계.** `primary`·`secondary`(기본)·`danger`(빨간 글자 보조)·`ghost`. `default`는 `secondary`로 바꿨다.
- **카드·행.** `Card`(둥글기 12, 면), `Row`(둥글기 8). 표 행도 선 대신 둥근 면으로 나눈다.
- **시간 표기 함수 하나.** `apps/web/src/format/time.ts`의 `useTime()`: `elapsed`("25분째"), `ago`("방금"·"25분 전"·하루 넘으면 날짜), `clock`("10:45"), `duration`("12분"). 운영자 시간대(0044)를 따른다. `format/duration.ts`를 대신한다.
- **메시지 낱말.** 상태·종류·화면·메뉴 이름을 영어 용어로: Running·Waiting for Input·Disconnected·Canceled·Question·Permission·Runner Issue·Home. `domain.attention`·`domain.runnerState`·`domain.time`을 더했다.
- **기존 사용처 옮기기.** 모든 화면의 상태 표시를 `StatusPill`로, 경과·상대 시간·타임라인 시각을 `useTime()`으로 옮겼다. Run 상세는 서버가 읽은 때(`now`)를 데이터에 담아 상대 시간을 잰다. Runners의 마지막 확인은 `checked: { at, agoMs }`로 바꿨다.
- `DESIGN.md`와 `/ds` 미리보기(상태 알약 13가지, 버튼 위계, 카드·행, 새 토큰)를 고쳤다.

## 남긴 것(뒤 하위 티켓)

- Tickets 런 이력의 할당 시각과 Settings 러너 확인 시각은 아직 `useFormatter`로 날짜·시각을 쓴다. 상대 시간으로 바꾸려면 두 화면의 데이터에 "지금"을 담아야 해 [0049e](0049e-other-screens.md)가 한다.
- 온보딩 단계 이름(Tracker·GitHub·Runner·Workspace·Mapping)은 단계 목록을 만드는 [0049d](0049d-runners-onboarding.md)가 메시지에 둔다.
- 화면당 파란 주 버튼 하나 시험, 레일 셸, Runner Issue의 Offline 러너는 0049b~e가 한다.

## 완료 조건

- 메시지 파일의 상태·종류·화면 이름 값이 영어 용어 목록과 같다는 시험(`apps/web/src/status.test.tsx`).
- Home·Runs의 상태 알약 글이 영어 용어이고 상태 값과 맞는다는 시험, 앱 코드가 다른 상태 표시를 가져오지 않는다는 시험(같은 파일).
- 상태 값마다 알약이 ADR 0010의 색을 고른다는 컴포넌트 시험(`packages/ui/src/components.test.tsx`).
- 시간 표기 함수 시험(`apps/web/src/format/time.test.tsx`): "25분째", "방금", "25분 전", 하루 넘으면 날짜, "10:45", 운영자 시간대.
- `tokens.test.ts`가 새 색 의미와 둥글기 값을 검사하고, `check:colors`·e2e·smoke가 통과한다.
