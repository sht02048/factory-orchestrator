---
status: doing
blocked_by: []
---

# 0116 Question이 선택지 없이 글 한 덩어리로 오는 문제

## 목표

에이전트가 운영자에게 묻는 질문을 Dashboard·Run 상세에서 바로 읽고 골라 답할 수 있게 한다. 선택지는 Orca `ask`의 `--options`로 따로 오게 하고, 그렇지 않은 질문도 글 안의 선택지를 나눠 보인다.

## 배경

운영자 보고(2026-11-19, 실제 런). Dashboard에 온 Question이 선택지 버튼 없이 글 한 덩어리로 보였다. 질문 본문은 이랬다(값은 그대로 옮기지 않고 모양만 남긴다).

> 02 작업 전제인 01(…)이 main(…)과 원격 브랜치 어디에도 없어요. 어떻게 할까요? (A) 01이 머지될 때까지 기다린다 — … (B) 지금 main의 …로 02를 먼저 하고, 01이 들어오면 맞춘다(충돌 가능). 기본 제안은 B예요.

같은 날 칸반 카드 위계도 지적받았다. 어떤 카드는 티켓 키 옆에 제목이 있고 어떤 카드는 키 아래에 제목이 있었고, Question 카드는 긴 질문 본문을 그대로 보여 카드가 길었다.

## 원인(확인한 사실)

- 질문은 러너 Orca의 `question` 메일로 온다. `packages/runner-orca/src/progress.ts`가 메일의 `payload.options`를 읽어 `AgentQuestion.options`로 넘기고, 없으면 빈 배열이다. Dashboard 상세 패널은 `choices`(= `options`)가 있으면 선택지마다 라디오를 그린다. 보고된 화면에 선택지 라디오가 하나도 없었으므로 이 질문의 `options`는 비어 있었다. 선택지는 본문 안에 `(A) … (B) …`로 들어 있었다.
- Ganger가 런을 맡길 때 에이전트에게 주는 지시는 `apps/worker/src/worker.ts`의 `promptFor`가 만든 `티켓 제목 + 빈 줄 + 티켓 본문`뿐이었다. `OrcaRunner.startRun`은 이 글을 그대로 `worker-start --spec-file -`의 stdin으로 넘겼다. "질문은 선택지와 함께(ask의 options)"라는 지시는 어디에도 없었다.
- Orca가 워커 앞에 붙이는 안내도 `orca orchestration ask --question "<your question>"`만 보이고 `--options`는 말하지 않는다. 그래서 에이전트는 선택지를 질문 문장에 썼다.
- `orca orchestration ask --help`: `--options <csv>`. 선택지는 쉼표로 나눈다([`docs/research/0008`](../research/0008-orca-orchestration-run.md)에서 `--options "A,B"`가 `payload.options: ["A","B"]`가 되는 것을 확인했다). 그래서 한 선택지 안에는 쉼표를 쓰면 안 된다.

## 범위

1. **에이전트 지시.** `packages/runner-orca/src/agent-brief.ts`의 `briefFor`가 티켓 글 뒤에 "운영자에게 물을 때" 안내를 붙이고, `startRun`이 이것을 stdin으로 넘긴다. 내용: 선택지는 `ask --options`에 쉼표로 나눠 따로 넘기고 한 선택지 안에 쉼표를 쓰지 않는다. 질문 문장에는 선택지를 다시 쓰지 않는다. 추천이 있으면 첫 선택지로 두고 ` (추천)`을 붙인다. `--options`는 Orca의 인자라 러너 어댑터(runner-orca)에 둔다.
2. **질문 글 읽기.** `packages/app/src/question.ts`의 `readQuestion(body, options)`.
   - `options`가 있으면 그대로 선택지로 쓰고 본문은 나누지 않는다.
   - 없으면 본문에서 선택지를 찾는다. 줄 머리의 `(A)`·`A)`·`A.`·`1.`·`1)`·`(1)` 목록, 또는 한 문단 안의 `(A) … (B) …`·`A) … B) …`. A·a·1에서 시작해 차례대로 두 개 이상이고, 목록 밖에 물음표가 있을 때만 선택지로 본다(한 일 목록을 선택지로 잘못 읽지 않게).
   - 마지막 선택지 뒤 문장이 선택지 글자를 말하면("기본 제안은 B예요") 선택지에서 떼어 선택지 아래 문장으로 둔다.
   - 고른 선택지의 답은 `(글자) 내용`이다. 나눌 수 없으면 문단·줄바꿈을 지킨 글 그대로 두고 답 칸 하나만 둔다.
3. **공용 질문 폼.** `packages/ui`에 `QuestionForm`을 더한다. Dashboard 상세 패널과 Run 상세가 함께 쓴다(웹은 `apps/web/src/question/question-answer.tsx`, 문구는 `messages/ko/question.json`). 고르기만 해서는 보내지 않는다(ADR 0010 6번). Run 상세 질문 카드는 선택지를 누르면 바로 보내던 보조 버튼에서 같은 라디오 + 보내기로 바뀐다(ADR 0010 0060 메모의 남은 일).
4. **제목과 질문 나누기.** 상세 패널 제목은 티켓 키(흐린 작은 글) + 제목이고, 질문은 "에이전트 질문" 구역(`PanelSection`) 안에 둔다.
5. **칸반 카드 위계.** 모든 카드를 꼬리표 줄(있을 때만) → 키 + 제목 한 흐름(두 줄에서 자름) → 요약 → 바닥 줄(메타 · 오른쪽 시간)로 둔다. Question 카드의 요약은 선택지를 뺀 질문이고, 선택지는 패널에서만 보인다.

Tickets 화면은 질문을 보이지 않아 고칠 곳이 없다.

## 완료 조건

- [ ] 시험: 선택지 나누기(여러 표기, 나눌 수 없는 경우), options가 있을 때 그대로 쓰기, 답 보내기 흐름(브라우저), 에이전트 지시에 문구가 들어가는지.
- [ ] 스크린숏: 보고된 질문(가짜 데이터)을 고친 뒤 모습, options가 있는 질문, 400px. 칸반 카드 네 장의 고치기 전·뒤.
- [ ] `better-interface`·`interface-review` 리뷰 표를 PR에 붙인다.
