export const QUERY_DEVTOOLS_TOGGLE_EVENT = "ganger:toggle-query-devtools";

export function toggleQueryDevtools(target: EventTarget): void {
  target.dispatchEvent(new Event(QUERY_DEVTOOLS_TOGGLE_EVENT));
}

export function onQueryDevtoolsToggle(target: EventTarget, toggle: () => void): () => void {
  target.addEventListener(QUERY_DEVTOOLS_TOGGLE_EVENT, toggle);
  return () => target.removeEventListener(QUERY_DEVTOOLS_TOGGLE_EVENT, toggle);
}
