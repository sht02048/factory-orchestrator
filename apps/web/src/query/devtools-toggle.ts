export const QUERY_DEVTOOLS_TOGGLE_EVENT = "ganger:toggle-query-devtools";
export const QUERY_DEVTOOLS_STATE_EVENT = "ganger:query-devtools-state";

export function toggleQueryDevtools(target: EventTarget): void {
  target.dispatchEvent(new Event(QUERY_DEVTOOLS_TOGGLE_EVENT));
}

export function onQueryDevtoolsToggle(target: EventTarget, toggle: () => void): () => void {
  target.addEventListener(QUERY_DEVTOOLS_TOGGLE_EVENT, toggle);
  return () => target.removeEventListener(QUERY_DEVTOOLS_TOGGLE_EVENT, toggle);
}

export function announceQueryDevtools(target: EventTarget, shown: boolean): void {
  target.dispatchEvent(new CustomEvent(QUERY_DEVTOOLS_STATE_EVENT, { detail: shown }));
}

export function onQueryDevtoolsState(
  target: EventTarget,
  listener: (shown: boolean) => void,
): () => void {
  const handle = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const shown: unknown = event.detail;
    if (typeof shown === "boolean") listener(shown);
  };
  target.addEventListener(QUERY_DEVTOOLS_STATE_EVENT, handle);
  return () => target.removeEventListener(QUERY_DEVTOOLS_STATE_EVENT, handle);
}
