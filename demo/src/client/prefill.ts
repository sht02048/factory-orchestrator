import {
  FAIL_AUTH,
  FAIL_NO_ORCA,
  FAIL_OFFLINE,
  FAIL_PUSH_AUTH,
  PREFILL,
  PREFILL_RUNNER_NAME,
} from "../values.ts";

/*
 * 개발 진입점에서만 브라우저에 싣는 작은 도구(티켓 0047, plugins.ts 가 web 의 client 모듈에 붙인다).
 * 오른쪽 아래에 개발 화면(/__dev) 링크와, 입력 칸이 있으면 가짜 값으로 채우는 버튼을 둔다. 제품 화면 코드와
 * 메시지 파일은 고치지 않는다. 프로덕션 빌드에는 이 플러그인이 없어 실리지 않는다.
 */

const ROOT_ID = "factory-dev-tools";

function setValue(input: HTMLInputElement, value: string): void {
  // React 가 붙은 입력은 value 를 바로 바꾸면 상태가 따라오지 않는다. 원래 setter 로 바꾸고 input 이벤트를 낸다.
  Reflect.set(HTMLInputElement.prototype, "value", value, input);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function fill(): number {
  let filled = 0;
  for (const input of document.querySelectorAll<HTMLInputElement>("main input[name]")) {
    const runnerForm = input.form?.querySelector("input[name=sshTarget]") != null;
    const value = input.name === "name" && runnerForm ? PREFILL_RUNNER_NAME : PREFILL[input.name];
    if (value === undefined || input.readOnly || input.value !== "") continue;
    setValue(input, value);
    filled += 1;
  }
  return filled;
}

function mount(): void {
  if (document.getElementById(ROOT_ID) !== null) return;
  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.setAttribute(
    "style",
    "position:fixed;right:12px;bottom:12px;z-index:2147483647;display:flex;gap:6px;" +
      "font:12px/1.4 system-ui,sans-serif",
  );
  const chip =
    // 화면 토큰을 쓰지 않는 개발 도구라 시스템 색으로 밝은·어두운 화면에 맞춘다.
    "padding:6px 10px;border-radius:999px;border:1px solid GrayText;background:Canvas;color:CanvasText;" +
    "cursor:pointer;text-decoration:none";

  const fillButton = document.createElement("button");
  fillButton.type = "button";
  fillButton.textContent = "가짜 값 채우기";
  fillButton.title =
    `실패를 보려면 키·토큰에 "${FAIL_AUTH}", ssh 대상에 ` +
    `"${FAIL_OFFLINE}"·"${FAIL_NO_ORCA}"·"${FAIL_PUSH_AUTH}"를 넣어요.`;
  fillButton.setAttribute("style", chip);
  fillButton.addEventListener("click", () => {
    if (fill() === 0) fillButton.textContent = "채울 칸이 없어요";
    setTimeout(() => (fillButton.textContent = "가짜 값 채우기"), 1500);
  });

  const link = document.createElement("a");
  link.href = "/__dev";
  link.target = "_blank";
  link.textContent = "개발 도구";
  link.setAttribute("style", chip);

  root.append(fillButton, link);
  document.body.append(root);
}

// 서버 렌더한 body 에 React 가 붙기 전에 노드를 더하면 hydration 이 어긋난다. 라우터가 붙은 뒤에 단다.
const waitForHydration = setInterval(() => {
  if (!("__TSR_ROUTER__" in globalThis)) return;
  clearInterval(waitForHydration);
  mount();
}, 200);
