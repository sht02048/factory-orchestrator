import { WINDOW_REGION_ATTRIBUTE, windowFrame } from "@ganger/ui/window-frame";

export const DRAG_REGION_SELECTOR = `[${WINDOW_REGION_ATTRIBUTE}="drag"]`;

export const DRAG_HANDLE_STYLE: Readonly<Record<string, string>> = {
  position: "fixed",
  top: "0",
  left: "0",
  width: `${windowFrame.railWidth}px`,
  height: `${windowFrame.titleBarHeight}px`,
  "z-index": "2147483647",
  "-webkit-app-region": "drag",
};

export interface HandleElement {
  style: { setProperty(name: string, value: string): void };
  setAttribute(name: string, value: string): void;
}

export interface DragHandleHost<E extends HandleElement> {
  querySelector(selector: string): unknown;
  createElement(tagName: "div"): E;
  body: { append(node: E): void } | null;
}

export function addDragHandleIfMissing<E extends HandleElement>(host: DragHandleHost<E>): boolean {
  if (host.querySelector(DRAG_REGION_SELECTOR) !== null || host.body === null) return false;
  const handle = host.createElement("div");
  handle.setAttribute("aria-hidden", "true");
  handle.setAttribute(WINDOW_REGION_ATTRIBUTE, "drag");
  for (const [name, value] of Object.entries(DRAG_HANDLE_STYLE))
    handle.style.setProperty(name, value);
  host.body.append(handle);
  return true;
}
