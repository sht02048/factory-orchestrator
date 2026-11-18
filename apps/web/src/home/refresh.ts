import { useEffect, useRef } from "react";

export const HOME_REFRESH_MS = 15_000;

export interface VisibilitySource {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export function refreshWhileVisible(
  doc: VisibilitySource,
  refresh: () => void,
  intervalMs: number,
): () => void {
  let timer: ReturnType<typeof setInterval> | undefined;
  const start = () => {
    timer ??= setInterval(refresh, intervalMs);
  };
  const stop = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const onVisibilityChange = () => {
    if (doc.visibilityState === "visible") {
      refresh();
      start();
    } else {
      stop();
    }
  };
  if (doc.visibilityState === "visible") start();
  doc.addEventListener("visibilitychange", onVisibilityChange);
  return () => {
    stop();
    doc.removeEventListener("visibilitychange", onVisibilityChange);
  };
}

export function useRefreshWhileVisible(refresh: () => void, intervalMs = HOME_REFRESH_MS): void {
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });
  useEffect(() => refreshWhileVisible(document, () => latest.current(), intervalMs), [intervalMs]);
}
