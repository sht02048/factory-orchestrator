import {
  ASK_QUERY_DEVTOOLS,
  DEV_CHANNEL,
  FAIL_AUTH,
  FAIL_NO_ORCA,
  FAIL_OFFLINE,
  FAIL_PUSH_AUTH,
  PREFILL,
  PREFILL_RUNNER_NAME,
} from "../values.ts";
import {
  onQueryDevtoolsState,
  setQueryDevtools,
} from "../../../apps/web/src/query/devtools-toggle.ts";

const ROOT_ID = "ganger-dev-tools";

function setValue(input: HTMLInputElement, value: string): void {
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

function bridgeQueryDevtools(): void {
  const channel = new BroadcastChannel(DEV_CHANNEL);
  let shown = false;
  let asked = false;
  onQueryDevtoolsState(window, (next) => {
    if (shown && !next) channel.postMessage({ setQueryDevtools: false });
    shown = next;
    if (asked) return;
    asked = true;
    channel.postMessage(ASK_QUERY_DEVTOOLS);
  });
  channel.addEventListener("message", (event: MessageEvent<unknown>) => {
    const message = event.data;
    if (message === ASK_QUERY_DEVTOOLS) channel.postMessage({ queryDevtools: shown });
    const wanted: unknown =
      typeof message === "object" && message !== null
        ? Reflect.get(message, "setQueryDevtools")
        : undefined;
    if (typeof wanted === "boolean") setQueryDevtools(window, wanted);
  });
}

bridgeQueryDevtools();

const waitForHydration = setInterval(() => {
  if (!("__TSR_ROUTER__" in globalThis)) return;
  clearInterval(waitForHydration);
  mount();
}, 200);
