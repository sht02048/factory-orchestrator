---
status: done
blocked_by: [0146]
---

# 0148 Human Check 요청과 답

## 목표

에이전트가 사람이 확인해야 끝나는 일을 `decision_gate`로 요청하면, Ganger가 Waiting for Input · Human Check로 보이고 To do·알림에서 Question과 따로 묶는다. 운영자는 "확인했어요" / "고쳐 주세요"로 답한다. 스펙 [0006](../spec/0006-agent-control.md) C3·C4, ADR [0023](../adr/0023-human-check-request.md).

## 배경

0145에서 요약 결과 이름의 Human Check를 뺐다. 에이전트가 머지 위험이 one-way인 PR처럼 사람 확인이 필요한 일을 만나도 알릴 길이 질문(`ask`)뿐이라, Question과 섞여 보이고 답의 뜻도 정해져 있지 않다.

## 할 일

1. 스파이크: Orca `decision_gate` 메시지를 보내고 받는 모양(명령, 출력, 답 보내기)을 러너에서 확인해 `docs/research/`에 남긴다. 확인 전에는 통신 규약 문장을 넣지 않는다.
2. 통신 규약(`packages/runner-orca/src/agent-brief.ts`의 `ASK_GUIDE`)에 "사람이 확인해야 끝나는 일은 `decision_gate`로 무엇을 확인할지와 링크를 보내고 답을 기다린다"를 더한다. 무엇을 요청할지는 넣지 않는다(C0).
3. Orca 러너가 `decision_gate`를 zod로 읽어 Waiting for Input의 Human Check 종류로 돌려준다. 답 보내기도 러너 어댑터에 더한다.
4. To do·알림 사건 종류에 Human Check를 더한다("확인해 주세요", 청록). Dashboard·Run 상세에서 Question과 따로 묶는다. ADR 0010의 색·묶음을 고친다.
5. 답: "확인했어요" / "고쳐 주세요" + 함께 보낼 말(선택). 답은 그 런의 에이전트에게 가고 런은 Running으로. Ganger는 머지하지 않는다.
6. MCP 읽기 출력에 Human Check 종류와 요청 내용(`external` 칸)을 보인다. 쓰기 도구는 더하지 않는다.
7. GLOSSARY의 To do·알림 사건 종류에 Human Check를 더한다(Human Check 낱말은 0146에서 정했다).

## 스파이크 결과

[research 0019](../research/0019-orca-decision-gate.md). `send --type decision_gate`는 `dispatchId`를 Orca가 채우지만, 보낸 뒤 차례를 끝내면 답이 와도 에이전트가 깨어나지 않는다. 그래서 통신 규약은 보낸 뒤 `check --wait`로 차례를 끝내지 않고 기다리게 한다.

## 완료 조건

- 시험: `decision_gate` 파싱, 상태와 종류, To do·알림 묶음, 답 두 가지와 함께 보낼 말, Running으로 돌아감, MCP, 400px.
- 스크린숏: Dashboard "확인해 주세요" 묶음, Run 상세 Human Check 답하기.
- 화면 변경 있음. DB 변경 있음(알림 사건 종류 값 목록이 바뀌면 one-way).
