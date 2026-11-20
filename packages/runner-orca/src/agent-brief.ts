export const ASK_GUIDE = [
  "## 운영자에게 물을 때",
  "",
  '- 선택지가 있는 질문은 `orca orchestration ask --question "<질문>" --options "<선택지1>,<선택지2>"`로 묻는다. 선택지는 `--options`에 쉼표로 나눠 따로 넘기고, 한 선택지 안에는 쉼표를 쓰지 않는다.',
  "- 질문 문장에는 선택지를 다시 쓰지 않는다. `(A) …`, `(B) …`처럼 본문에 늘어놓지 않는다.",
  "- 추천하는 선택지가 있으면 첫 선택지로 두고 끝에 ` (추천)`을 붙인다.",
  "- 막혀서 더 나아갈 수 없을 때도 `escalation`을 보내지 않고 `ask`로 묻는다. 무엇이 막혔는지 질문에 쓰고, 운영자가 고를 수 있는 다음 행동을 `--options`로 단다.",
  "- 질문을 보낸 뒤에는 차례를 끝내고 답을 기다린다. 질문이나 `worker_done` 없이 차례를 끝내면 운영자는 멈춘 것으로 본다.",
].join("\n");

export function briefFor(ticketPrompt: string): string {
  return `${ticketPrompt}\n\n${ASK_GUIDE}\n`;
}
