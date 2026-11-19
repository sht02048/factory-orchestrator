export const ASK_GUIDE = [
  "## 운영자에게 물을 때",
  "",
  '- 선택지가 있는 질문은 `orca orchestration ask --question "<질문>" --options "<선택지1>,<선택지2>"`로 묻는다. 선택지는 `--options`에 쉼표로 나눠 따로 넘기고, 한 선택지 안에는 쉼표를 쓰지 않는다.',
  "- 질문 문장에는 선택지를 다시 쓰지 않는다. `(A) …`, `(B) …`처럼 본문에 늘어놓지 않는다.",
  "- 추천하는 선택지가 있으면 첫 선택지로 두고 끝에 ` (추천)`을 붙인다.",
].join("\n");

export function briefFor(ticketPrompt: string): string {
  return `${ticketPrompt}\n\n${ASK_GUIDE}\n`;
}
