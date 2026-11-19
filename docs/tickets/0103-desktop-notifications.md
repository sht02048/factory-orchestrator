---
status: todo
blocked_by: []
---

# 0103 데스크톱 알림 개선: 서버 알림 사건 저장소 + SSE

## 목표

데스크톱 앱 알림을 서버가 만든 알림 사건으로 바꾼다. 서버가 사건(번호, 종류, 대상, 해결 여부)을 저장하고, 데스크톱 앱은 SSE로 바로 받는다. 처리할 일과 Runner Issue를 빠짐없이 알리고, 다른 곳에서 처리하면 알림을 지우며, 알림을 Mac마다 켜고 끌 수 있게 한다.

## 배경

운영자가 grilling으로 정했다(2026-11-19). 지금은 데스크톱 앱이 15초마다 `GET /api/attention`을 폴링하고, 앞 응답에 없던 key만 알린다(`apps/desktop/src/main/controller.ts`의 `ATTENTION_INTERVAL_MS`, `apps/desktop/src/core/attention.ts`의 `AttentionDiff`). 그래서 다음이 빈다.

- Failed, Disconnected, GitHub 인증이 깨진 러너, 공급자 사용량 한도는 알리지 않는다.
- 앱이 꺼져 있거나 Mac이 잠든 동안 생긴 일은 알리지 않는다.
- 기억이 앱 메모리에만 있어, 러너 Offline이 깜빡이면 같은 알림이 다시 울린다.
- 다른 곳에서 처리해도 받은 알림을 지우지 않는다. 묶기·배지·설정이 없다.
- 코드 이름 `attention`이 GLOSSARY To do의 _Avoid_ "Attention"과 겹친다.

모바일 앱은 이 티켓 뒤로 미뤘다([research 0014](../research/0014-mobile-client.md)). 이 티켓의 사건 저장소는 나중에 모바일 푸시와 외부 알림 연동이 같이 쓴다.

## 범위

1. **알릴 사건.** Question, Permission, Human Check, Failed, Disconnected, Runner Issue(Offline, GitHub 인증 깨짐, 공급자 사용량 한도)를 알린다. Merged·Canceled, Queued·Running으로 옮김은 알리지 않는다(Merged를 켜는 선택지도 두지 않는다). 칸반 기준으로는 카드에 꼬리표가 붙을 때와 Runner Issue가 생길 때만 울린다.
2. **0046 결정 바꾸기.** 티켓 0046 Q4("Merged·Failed는 알리지 않는다") 중 Failed 쪽을 바꾼다. Failed는 사람이 다시 맡겨야 끝나는 처리할 일이라 알린다. `apps/web/src/attention/attention.test.ts`의 해당 시험을 새 결정으로 바꾼다.
3. **소리.** Question, Permission, Failed, Disconnected, Runner Issue는 소리를 낸다. Human Check는 소리 없이 알린다. 집중 모드를 뚫는 알림(특별 권한)은 쓰지 않는다.
4. **해결되면 지우기.** 다른 곳(웹, 다른 Mac)에서 처리해 사건이 해결되면 이 Mac 알림 센터의 그 알림을 지운다.
5. **다시 알리기.** Question·Permission이 10분 동안 해결되지 않으면 한 번만 다시 알린다. 에이전트가 기다리는 동안에도 최대 실행 시간이 흐르기 때문이다.
6. **묶기.** 5초 안에 3건을 넘게 오면 "처리할 일 {n}개가 생겼어요" 하나로 알리고, 누르면 Dashboard `?view=todo`를 연다.
7. **놓친 일.** 앱을 켜거나 Mac이 깼을 때 그 사이 생긴 사건 중 아직 해결되지 않은 것만 모아 알림 하나로 보인다("꺼져 있던 동안 처리할 일 {n}개가 생겼어요"). 이미 해결된 사건은 빼고, 하나씩 울리지 않는다.
8. **누르면.** 칸반 Dashboard(0100)에서 그 카드의 상세 패널을 연 채로 연다. Runner Issue는 Runners 화면의 그 러너를 연다. 알림 안 버튼(답하기·거절하기)은 두지 않는다(ADR 0010 6번).
9. **Dock 배지.** 처리할 일 개수를 보인다. Runner Issue는 To do가 아니라 넣지 않는다.
10. **설정(Mac마다).** 데스크톱 앱 설정 창(메뉴·트레이에서 연다)에 알림 전체 켜기·끄기와 종류별 다섯 줄(Question, Permission, Human Check, Failed·Disconnected, Runner Issue)을 둔다. 설정은 그 Mac 앱에만 저장한다. 방해 금지 시간은 만들지 않고 macOS 집중 모드에 맡긴다. macOS에서 Ganger 알림 권한이 꺼져 있으면 설정 창 맨 위에 "macOS에서 Ganger 알림이 꺼져 있어요"와 시스템 설정을 여는 버튼을 보이고, 그 밖에는 조용히 둔다.
11. **여러 Mac.** 앱을 켠 Mac에서 모두 울린다. 한쪽에서 처리하면 다른 쪽 알림은 지워진다(4번).
12. **서버 알림 사건 저장소.** 사건마다 단조 증가 번호, 종류, 대상(런·티켓·러너), 생긴 시각, 해결 여부와 해결 시각을 저장한다. 같은 원인은 사건 하나다(같은 러너의 같은 원인이 해결 전이면 새 사건을 만들지 않아 Offline 깜빡임이 다시 울리지 않는다). 해결된 사건은 7일 뒤 지운다. DB 마이그레이션의 되돌림 방법을 PR의 머지 위험에 적는다.
13. **SSE.** 데스크톱 앱은 SSE 연결을 열어 두고 사건을 바로 받는다. 끊기면 다시 붙으며 `Last-Event-ID`로 마지막 번호 뒤의 사건만 받는다. 프록시(Tailscale Serve 등)에서 끊기지 않게 하트비트를 보낸다. SSE가 안 되면 같은 저장소를 읽는 폴링(5초)으로 돌아간다. 요청은 `packages/app/src/request-guard.ts`를 지나고, 받은 이벤트는 경계에서 zod로 파싱한다.
14. **이름.** 새 개념 "알림 사건"(Notification event)을 GLOSSARY에 더한다: 운영자에게 알릴 만한 일이 생긴 기록. To do·Runner Issue와 짝을 이루지만 상태가 아니다. 코드의 `attention`을 이 이름으로 바꾼다. `/api/attention`은 새 경로로 옮기고, 옛 데스크톱 버전을 위해 옛 경로를 언제까지 둘지 이 티켓에 적는다.
15. **GLOSSARY Runner Issue.** 공급자 사용량 한도를 Runner Issue의 한 종류로 넣는다. 상태 이름은 새로 만들지 않는다.

## 연결 메모

- 0099가 데스크톱 앱의 러너 등록 요청을 `GET /api/runner-enrollment/offer` 3초 폴링으로 알아챈다. 이 티켓이 SSE를 깔면 그 요청을 SSE 이벤트 한 종류로 옮기고, 그 폴링은 SSE가 안 될 때의 fallback으로 둔다. 등록 요청 이벤트에는 토큰을 싣지 않는다(토큰은 앱에서 사람이 누를 때 accept로만 받는다).

## 범위 밖

- 외부 알림 연동(ntfy, Slack 등). 같은 사건 저장소를 쓰는 후속으로 둔다.
- 알림 안 버튼(답하기, 거절하기).
- 모바일 푸시([research 0014](../research/0014-mobile-client.md)).

## 완료 조건

- 사건 저장소 시험: 같은 원인이 사건 하나로 묶임, 해결 기록, 7일 정리, 번호가 단조 증가.
- SSE 시험: 연결해 바로 받음, 끊긴 뒤 `Last-Event-ID`로 이어 받음, SSE가 안 될 때 폴링으로 같은 사건을 받음.
- 데스크톱 시험: 종류별 소리, 묶기(5초·3건), 10분 뒤 한 번 다시 알리기, 놓친 일 요약, 해결 시 지우기, 알림 전체·종류별 설정, Dock 배지 개수, 누르면 여는 주소.
- 0046 결정을 바꾼 이유를 이 티켓에 적고 `attention.test.ts`를 새 결정으로 고친다.
- GLOSSARY에 "알림 사건"을 더하고 Runner Issue 정의를 넓힌다.
- 데스크톱 앱 알림 설정 창 스크린숏(권한 꺼짐 안내 포함)을 PR에 붙인다.
