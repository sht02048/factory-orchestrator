---
status: todo
blocked_by: [0068]
---

# 0069 Dashboard v2

## 목표

0068의 Dashboard 결정을 구현한다. 티켓 0066(Dashboard 다듬기)의 항목도 여기서 한다.

## 화면

- **제목**: 메타 줄 "Dashboard", 제목(26px) "처리할 일이 {n}개 있어요", 요약 "답할 질문 {a}개, 확인할 PR {b}개, 실패한 런 {c}개예요."(0인 항목은 뺀다). To do가 0이면 "처리할 일이 없어요"와 In progress 요약.
- **To do**(면 있는 카드, 머리 20px "To do {n}"): 묶음 셋.
  - 답이 필요해요 · {n} (보라 점, 설명 "에이전트가 멈춰 기다려요"): Question 행(질문 문장, 경과, "답하기" → 0060의 질문 레이어), Permission 행(명령 · 허용은 러너에서, "거절하기").
  - 확인해 주세요 · {n} (노랑 점, "PR이 열려 있어요"): 키, 제목 자리, PR 번호, "PR 보기".
  - 멈췄어요 · {n} (빨강 점, "Tickets에서 다시 할당할 수 있어요"): Disconnected("{러너}에 {경과}째 닿지 않아요"), Failed("Failed · {시각}"). 3개만 보이고 "{n}개 더 보기"로 펼친다.
    - Disconnected 런은 끝나지 않아 다시 할당할 수 없다(GLOSSARY Tickets 필터, 0068). 묶음 설명은 Failed와 Disconnected 행 모두에 맞는 문장으로 쓴다.
- **In progress**(면 없음, 머리 17px "In progress {n}", "Runs에서 보기"): 상태 점 · 키 · 제목 자리 · 러너·경과.
- **오른쪽 열**(면 없음, 340px):
  - Runners: 러너마다 상태 점 · 이름 · capacity 막대 · "1/2". 문제가 있으면 아래에 빨간 상자 하나("러너 {n}대에 문제가 있어요", 이유 요약, "Runners에서 고치기").
  - Done today {n}: 상태 점 · 키 · 요약 결과 · 상대 시간, "Runs에서 모두 보기".
- 넓은 폭 두 열, 본문 720px 아래(창 약 870px) 한 열.

## 0066에서 가져온 것

질문 레이어의 선택지에서 Enter는 고르기만 한다. 다시 연 레이어에 예전 오류가 없다. 모든 Workspace 보기에서 Done today를 보이고 Workspace 이름을 붙인다. `DoneRun`·`runHref`는 branded ID를 쓴다.

## 완료 조건

- 묶음별 행 수·설명 시험, "더 보기" 시험, 질문 레이어 Enter 시험.
- 1280px·375px 스크린숏을 PR에 붙인다.
