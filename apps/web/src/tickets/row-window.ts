import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";

const ROWS_BEFORE_MEASURING = 30;
const EXTRA_ROWS_EACH_SIDE = 6;
const ROW_PITCH_BEFORE_MEASURING = 54;
const ROW_GAP_BEFORE_MEASURING = 2;

export interface RowWindow {
  start: number;
  end: number;
  spaceBefore: number;
  spaceAfter: number;
}

interface WindowState {
  start: number;
  end: number;
  pitch: number;
  gap: number;
}

export function useRowWindow(
  root: RefObject<HTMLElement | null>,
  rowCount: number,
  indexToKeepInView: number,
): RowWindow {
  const [state, setState] = useState<WindowState>(() => ({
    start: 0,
    end: Math.min(rowCount, ROWS_BEFORE_MEASURING),
    pitch: ROW_PITCH_BEFORE_MEASURING,
    gap: ROW_GAP_BEFORE_MEASURING,
  }));

  useLayoutEffect(() => {
    const element = root.current;
    if (element === null) return;
    const scroller = scrollParent(element);
    const update = () => {
      const list = element.querySelector('[role="listbox"]');
      if (list === null) return;
      setState((prev) => {
        const { pitch, gap } = measureRows(list) ?? prev;
        const listTop = list.getBoundingClientRect().top;
        const view = visibleArea(scroller);
        const visibleFrom = Math.max(0, view.top - listTop);
        const visibleTo = Math.max(0, view.bottom - listTop);
        const start = clamp(Math.floor(visibleFrom / pitch) - EXTRA_ROWS_EACH_SIDE, 0, rowCount);
        const end = clamp(Math.ceil(visibleTo / pitch) + EXTRA_ROWS_EACH_SIDE, start, rowCount);
        const unchanged =
          prev.start === start && prev.end === end && prev.pitch === pitch && prev.gap === gap;
        return unchanged ? prev : { start, end, pitch, gap };
      });
    };
    update();
    const scrollTarget: HTMLElement | Window = scroller ?? window;
    scrollTarget.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const observer = new ResizeObserver(update);
    observer.observe(scroller ?? element);
    return () => {
      scrollTarget.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer.disconnect();
    };
  }, [root, rowCount]);

  useLayoutEffect(() => {
    const element = root.current;
    if (element === null || indexToKeepInView < 0) return;
    const list = element.querySelector('[role="listbox"]');
    if (list === null) return;
    const scroller = scrollParent(element);
    const { pitch, gap } = measureRows(list) ?? {
      pitch: ROW_PITCH_BEFORE_MEASURING,
      gap: ROW_GAP_BEFORE_MEASURING,
    };
    const rowTop = list.getBoundingClientRect().top + indexToKeepInView * pitch;
    const rowBottom = rowTop + pitch - gap;
    const view = visibleArea(scroller);
    let delta = 0;
    if (rowTop < view.top) delta = rowTop - view.top;
    else if (rowBottom > view.bottom) delta = rowBottom - view.bottom;
    if (delta === 0) return;
    if (scroller === null) window.scrollBy(0, delta);
    else scroller.scrollTop += delta;
  }, [root, indexToKeepInView]);

  const start = Math.min(state.start, rowCount);
  const end = clamp(state.end, start, rowCount);
  return {
    start,
    end,
    spaceBefore: start > 0 ? start * state.pitch - state.gap : 0,
    spaceAfter: end < rowCount ? (rowCount - end) * state.pitch - state.gap : 0,
  };
}

function measureRows(list: Element): { pitch: number; gap: number } | null {
  const rows = list.querySelectorAll('[role="option"]');
  const first = rows[0];
  const second = rows[1];
  if (first === undefined || second === undefined) return null;
  const firstRect = first.getBoundingClientRect();
  const pitch = second.getBoundingClientRect().top - firstRect.top;
  if (pitch <= 0) return null;
  return { pitch, gap: Math.max(0, pitch - firstRect.height) };
}

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

function visibleArea(scroller: HTMLElement | null): { top: number; bottom: number } {
  if (scroller === null) return { top: 0, bottom: window.innerHeight };
  const top = scroller.getBoundingClientRect().top + scroller.clientTop;
  return { top, bottom: top + scroller.clientHeight };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
