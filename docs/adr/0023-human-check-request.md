# Human Check 요청은 Orca `decision_gate` 메시지로 받고 Question과 종류를 나눈다

0145에서 요약 결과 이름의 Human Check를 뺐다(ADR [0022](0022-run-outcome-from-agent-report.md)). 그때 "Human Check는 나중에 에이전트가 요청하는 Waiting for Input 종류로 돌아온다"고 남겼다. 2026-11-21 운영자가 시안을 승인하며 C3·C4를 정했다(스펙 [0006](../spec/0006-agent-control.md) 2절). 에이전트가 사람이 확인해야 끝나는 일(예: 머지 위험이 one-way인 PR)을 만나면 무엇을 확인할지와 링크를 보내고 답을 기다린다. Ganger는 이를 Question과 따로 보이고 따로 답받는다.

## 결정

- **에이전트는 Human Check를 Orca 오케스트레이션의 `decision_gate` 메시지로 보낸다.** 질문(`ask`)과 다른 메시지 종류다. 통신 규약(`ASK_GUIDE`)에 "사람이 확인해야 끝나는 일은 `decision_gate`로 무엇을 확인할지와 링크를 보내고 답을 기다린다"를 더한다(0148).
- **Ganger는 이를 Waiting for Input의 셋째 종류 Human Check로 읽는다.** Question·Permission과 나란하다. To do와 알림 사건에서 Question과 따로 묶고("확인해 주세요", 청록), 답은 "확인했어요" / "고쳐 주세요"와 함께 보낼 말(선택)이다. 답하면 런은 Running으로 돌아간다. Ganger는 머지하지 않는다.
- **무엇을 Human Check로 요청할지는 Ganger가 정하지 않는다.** 프로젝트 규칙이나 Workspace 앞뒤 지시(0146)가 정한다. 통신 규약은 보내는 법만 담는다(스펙 0006 C0).

## 되돌리기 어려운 이유

메시지 종류 하나가 여러 곳에 박힌다. 에이전트가 받는 지시서의 통신 규약(이미 시작한 런은 받은 지시서를 바꿀 수 없다), Waiting for Input의 종류와 To do 종류, 알림 사건 종류(DB 값 목록, 데스크톱·모바일 알림), MCP 출력(`input.kind`), 화면의 묶음과 색(ADR [0010](0010-ui-words-and-visual-rules.md))이 이 종류에 기댄다. 나중에 다른 신호로 바꾸면 이 모두와, 옛 통신 규약을 받고 도는 런이 함께 어긋난다.

## 고려한 대안

- **`ask`에 표시를 붙이기.** 질문 문장 앞에 `[Human Check]` 같은 표시를 붙이거나 정해진 선택지("확인했어요", "고쳐 주세요")로 구분한다. Orca 쪽 변경이 없지만, 표시는 에이전트가 문장으로 지키는 약속이라 빠지거나 틀리기 쉽고, 빠지면 Question으로 보여 다른 묶음·다른 알림으로 간다. 운영자가 고른 답과 확인의 뜻도 섞인다. 메시지 종류로 나누면 러너 어댑터가 zod로 종류를 파싱해 경계에서 갈린다.
- **PR 본문 해석.** 에이전트가 PR 본문에 "머지 위험: one-way" 같은 줄을 적으면 Ganger가 PR을 읽어 Human Check로 띄운다. 이 저장소의 PR 템플릿에 기대는 방식이라 다른 사람의 저장소에서는 맞지 않고(ADR [0005](0005-self-hosted-product.md)), PR이 없는 확인(배포 확인, 설정 변경)을 담지 못한다. 에이전트가 답을 기다리지도 않아 런은 그대로 끝나거나 돈다. PR 정보는 결과를 바꾸지 않는다는 결정(스펙 [0005](../spec/0005-run-outcome.md) R1)과도 어긋난다.

## 결과

- 0148이 통신 규약 문장, Orca 러너의 `decision_gate` 읽기(zod), Waiting for Input 종류, To do·알림 사건 종류, Run 상세·Dashboard의 답하기, MCP 출력, ADR 0010의 색·묶음을 고친다. 알림 사건 종류 값 목록이 바뀌면 DB 마이그레이션이 있다.
- 0145 전의 요약 결과 Human Check와 이름이 같지만 뜻이 다르다. GLOSSARY의 Human Check는 Waiting for Input 종류만 가리킨다.
- `decision_gate`의 출력 모양은 0148이 스파이크로 확인한다. 확인 전에는 통신 규약에 그 문장을 넣지 않는다.
