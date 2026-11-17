---
status: todo
blocked_by: [0005, 0007, 0014]
---

# web Linear webhook 수신

## 목표

Linear webhook을 받아 검증하고 DB에 기록한다. 할당은 worker가 한다.

## 범위

- 이 티켓은 `apps/web`의 webhook 라우트와, web 서버가 DB 설정에서 tracker-linear를 만드는 코드만 고친다. 앱 셸과 화면은 고치지 않는다. 0021·0025가 이 코드를 다시 쓴다.
- 원문 바이트로 tracker-linear의 검증을 부르고, 통과한 이벤트를 `Linear-Delivery` 중복 제거 키와 함께 DB에 쓴 뒤 5초 안에 200으로 응답한다(research 0002 B.2).
- 검증에 실패하면 이벤트를 쓰지 않고 실패 응답을 한다. 같은 `Linear-Delivery`가 다시 오면 200으로 응답하고 다시 쓰지 않는다.
- 어느 Tracker Connection의 webhook인지 가려 그 연결의 signing secret으로 검증한다.

## 완료 조건

- 0011 픽스처로 서명이 맞는 요청은 DB에 하나 기록되고 200, 틀린 요청은 기록되지 않는다는 테스트가 통과한다.
- 같은 요청을 두 번 보내도 기록이 하나라는 테스트가 통과한다.
