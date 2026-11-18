/*
 * 개발 화면(/__dev, 티켓 0047). 제품 화면이 아니라 개발 진입점에서만 뜨는 도구라 메시지 파일과 디자인 시스템을
 * 쓰지 않고 이 파일에 문구를 둔다. 버튼은 가짜 트래커·러너를 바꿔 worker 와 화면이 반응하는지 보게 한다.
 */

const ACTIONS: ReadonlyArray<{ path: string; label: string; help: string }> = [
  {
    path: "label",
    label: "티켓에 라벨 붙이기",
    help: "Auto-assign Label 을 붙이고 webhook 이 온 것처럼 알려요. 곧 자동 할당으로 Queued 런이 생겨요.",
  },
  {
    path: "ticket",
    label: "새 티켓 만들기",
    help: "라벨 없는 티켓을 만들어요. Tickets 화면에서 직접 할당해 볼 수 있어요.",
  },
  {
    path: "question",
    label: "에이전트가 질문하기",
    help: "일하는 런 하나가 질문해요. 홈의 손댈 일에 오르고 답할 수 있어요.",
  },
  {
    path: "push-auth",
    label: "GitHub 인증 고치기·깨기",
    help: "runner-b 의 GitHub 인증을 바꿔요. Runners 화면과 할당 가능 여부가 따라 바뀌어요.",
  },
  {
    path: "life",
    label: "자동 진행 켜기·끄기",
    help: "가짜 에이전트가 시간에 따라 일하고 PR 을 여는 진행을 멈추거나 다시 켜요.",
  },
];

export function devPage(lifeEnabled: boolean): string {
  const buttons = ACTIONS.map(
    (action) => `
      <li>
        <button type="button" data-path="${action.path}">${action.label}</button>
        <p>${action.help}</p>
      </li>`,
  ).join("");
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>개발 도구</title>
<style>
  :root { color-scheme: light dark; font: 14px/1.5 system-ui, sans-serif; }
  body { max-width: 560px; margin: 32px auto; padding: 0 16px; }
  ul { list-style: none; padding: 0; display: grid; gap: 12px; }
  button { font: inherit; padding: 6px 12px; cursor: pointer; }
  p { margin: 4px 0 0; color: GrayText; }
  output { display: block; margin-top: 16px; font-family: ui-monospace, monospace; }
</style>
</head>
<body>
<h1>개발 도구</h1>
<p>가짜 어댑터로 도는 개발 진입점이에요. 실제 트래커·러너·GitHub 에 닿지 않아요.
자동 진행: <strong id="life">${lifeEnabled ? "켜짐" : "꺼짐"}</strong> · <a href="/">홈으로</a></p>
<ul>${buttons}</ul>
<output id="result"></output>
<script type="module">
  const result = document.getElementById("result");
  for (const button of document.querySelectorAll("button[data-path]")) {
    button.addEventListener("click", async () => {
      const response = await fetch("/__dev/" + button.dataset.path, { method: "POST" });
      const body = await response.json().catch(() => null);
      result.textContent = response.ok ? JSON.stringify(body) : "실패했어요 (" + response.status + ")";
      if (body && "enabled" in body) {
        document.getElementById("life").textContent = body.enabled ? "켜짐" : "꺼짐";
      }
    });
  }
</script>
</body>
</html>`;
}
