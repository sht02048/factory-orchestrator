import { useEffect, useRef } from "react";

/** Home 을 다시 읽는 주기(티켓 0050). 문서가 보일 때만 돈다 */
export const HOME_REFRESH_MS = 15_000;

/** 문서가 보이는지 알리는 부분만. 시험은 가짜 문서를 넘긴다 */
export interface VisibilitySource {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/**
 * 문서가 보이는 동안 `intervalMs` 마다 `refresh` 를 부른다. 숨겨지면 멈추고, 다시 보이면 곧바로 한 번
 * 부른 뒤 다시 돈다(숨겨진 동안 바뀐 것을 바로 보인다). 처음 시작할 때는 부르지 않는다(로더가 막 읽었다).
 * 멈추는 함수를 돌려준다.
 */
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

/** 브라우저에서 문서가 보이는 동안 `refresh` 를 주기적으로 부른다 */
export function useRefreshWhileVisible(refresh: () => void, intervalMs = HOME_REFRESH_MS): void {
  // 렌더마다 새로 만든 함수를 받아도 타이머를 다시 걸지 않는다
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });
  useEffect(() => refreshWhileVisible(document, () => latest.current(), intervalMs), [intervalMs]);
}
