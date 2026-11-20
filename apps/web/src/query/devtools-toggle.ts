export const QUERY_DEVTOOLS_SET_EVENT = "ganger:set-query-devtools";
export const QUERY_DEVTOOLS_STATE_EVENT = "ganger:query-devtools-state";

export function setQueryDevtools(target: EventTarget, shown: boolean): void {
  target.dispatchEvent(new CustomEvent(QUERY_DEVTOOLS_SET_EVENT, { detail: shown }));
}

export function onQueryDevtoolsSet(
  target: EventTarget,
  listener: (shown: boolean) => void,
): () => void {
  return onBooleanEvent(target, QUERY_DEVTOOLS_SET_EVENT, listener);
}

export function announceQueryDevtools(target: EventTarget, shown: boolean): void {
  target.dispatchEvent(new CustomEvent(QUERY_DEVTOOLS_STATE_EVENT, { detail: shown }));
}

export function onQueryDevtoolsState(
  target: EventTarget,
  listener: (shown: boolean) => void,
): () => void {
  return onBooleanEvent(target, QUERY_DEVTOOLS_STATE_EVENT, listener);
}

function onBooleanEvent(
  target: EventTarget,
  type: string,
  listener: (value: boolean) => void,
): () => void {
  const handle = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const value: unknown = event.detail;
    if (typeof value === "boolean") listener(value);
  };
  target.addEventListener(type, handle);
  return () => target.removeEventListener(type, handle);
}
