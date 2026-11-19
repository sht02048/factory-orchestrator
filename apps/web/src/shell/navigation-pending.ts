import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const PENDING_SHOW_AFTER_MS = 150;
export const PENDING_SHOWN_AT_LEAST_MS = 300;

export interface PendingTimers {
  now: () => number;
  schedule: (run: () => void, ms: number) => () => void;
}

export const realTimers: PendingTimers = {
  now: () => Date.now(),
  schedule: (run, ms) => {
    const handle = setTimeout(run, ms);
    return () => clearTimeout(handle);
  },
};

export class DelayedPending {
  #loading = false;
  #shown = false;
  #shownAt = 0;
  #cancel: (() => void) | null = null;

  readonly #timers: PendingTimers;
  readonly #onChange: (shown: boolean) => void;

  constructor(timers: PendingTimers, onChange: (shown: boolean) => void) {
    this.#timers = timers;
    this.#onChange = onChange;
  }

  set(loading: boolean): void {
    if (loading === this.#loading) return;
    this.#loading = loading;
    this.#clear();
    if (loading) {
      if (!this.#shown) this.#schedule(PENDING_SHOW_AFTER_MS, () => this.#show(true));
      return;
    }
    if (!this.#shown) return;
    const left = this.#shownAt + PENDING_SHOWN_AT_LEAST_MS - this.#timers.now();
    if (left <= 0) this.#show(false);
    else this.#schedule(left, () => this.#show(false));
  }

  dispose(): void {
    this.#clear();
  }

  #show(shown: boolean): void {
    this.#cancel = null;
    this.#shown = shown;
    if (shown) this.#shownAt = this.#timers.now();
    this.#onChange(shown);
  }

  #schedule(ms: number, run: () => void): void {
    this.#cancel = this.#timers.schedule(run, ms);
  }

  #clear(): void {
    this.#cancel?.();
    this.#cancel = null;
  }
}

export function useNavigationPending(): boolean {
  const loading = useRouterState({ select: (state) => state.status === "pending" });
  const [shown, setShown] = useState(false);
  const pending = useRef<DelayedPending | null>(null);
  useEffect(() => {
    const delayed = new DelayedPending(realTimers, setShown);
    pending.current = delayed;
    return () => {
      delayed.dispose();
      pending.current = null;
    };
  }, []);
  useEffect(() => {
    pending.current?.set(loading);
  }, [loading]);
  return shown;
}
