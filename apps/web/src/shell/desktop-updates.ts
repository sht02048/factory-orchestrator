import { useEffect, useState } from "react";
import { z } from "zod";
import { DESKTOP_UPDATES_GLOBAL, updateViewSchema } from "@ganger/app/updates/view";
import type { UpdateAction, UpdateView } from "@ganger/app/updates/view";

export interface DesktopUpdates {
  current(): Promise<UpdateView | null>;
  subscribe(listener: (view: UpdateView) => void): () => void;
  act(action: UpdateAction): void;
}

const callable = z.custom<(...args: never[]) => unknown>((value) => typeof value === "function");

const bridgeSchema = z.object({
  getUpdate: z.custom<() => unknown>((value) => typeof value === "function"),
  onUpdate: z.custom<(listener: (view: unknown) => void) => unknown>(
    (value) => typeof value === "function",
  ),
  act: z.custom<(action: string) => unknown>((value) => typeof value === "function"),
});

function parseView(value: unknown): UpdateView | null {
  const parsed = updateViewSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function desktopUpdates(scope: object = globalThis): DesktopUpdates | null {
  const parsed = bridgeSchema.safeParse(Reflect.get(scope, DESKTOP_UPDATES_GLOBAL));
  if (!parsed.success) return null;
  const bridge = parsed.data;
  return {
    current: () =>
      Promise.resolve(bridge.getUpdate()).then(
        (value) => parseView(value),
        () => null,
      ),
    subscribe(listener) {
      const off = callable.safeParse(
        bridge.onUpdate((value) => {
          const view = parseView(value);
          if (view !== null) listener(view);
        }),
      );
      return () => {
        if (off.success) off.data();
      };
    },
    act(action) {
      void Promise.resolve(bridge.act(action)).catch(() => undefined);
    },
  };
}

export type DesktopUpdatesState =
  | { kind: "unknown" }
  | { kind: "browser" }
  | { kind: "desktop"; view: UpdateView | null; act: (action: UpdateAction) => void };

export function useDesktopUpdates(): DesktopUpdatesState {
  const [state, setState] = useState<DesktopUpdatesState>({ kind: "unknown" });
  useEffect(() => {
    const bridge = desktopUpdates();
    if (bridge === null) {
      setState({ kind: "browser" });
      return;
    }
    const act = (action: UpdateAction) => bridge.act(action);
    let live = true;
    setState({ kind: "desktop", view: null, act });
    const off = bridge.subscribe((view) => setState({ kind: "desktop", view, act }));
    void bridge.current().then((view) => {
      if (live && view !== null) {
        setState((previous) =>
          previous.kind === "desktop" && previous.view !== null
            ? previous
            : { kind: "desktop", view, act },
        );
      }
    });
    return () => {
      live = false;
      off();
    };
  }, []);
  return state;
}
