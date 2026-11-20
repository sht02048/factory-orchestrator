import {
  BROWSER_ERROR_MESSAGE_LIMIT,
  BROWSER_ERROR_STACK_LIMIT,
} from "@ganger/app/diagnostics/model";
import type { BrowserErrorInput } from "@ganger/app/diagnostics/model";

export const BROWSER_ERRORS_PER_PAGE = 10;

type Kind = BrowserErrorInput["kind"];

export interface BrowserErrorTarget {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

export interface BrowserErrorReporter {
  report(kind: Kind, value: unknown): void;
  watch(target: BrowserErrorTarget): () => void;
}

function describe(value: unknown): { message: string; stack: string | null } {
  if (value instanceof Error) {
    return { message: `${value.name}: ${value.message}`, stack: value.stack ?? null };
  }
  if (typeof value === "string") return { message: value, stack: null };
  try {
    return { message: JSON.stringify(value) ?? String(value), stack: null };
  } catch {
    return { message: String(value), stack: null };
  }
}

export function browserErrorInput(kind: Kind, value: unknown, path: string): BrowserErrorInput {
  const { message, stack } = describe(value);
  return {
    kind,
    message: message.slice(0, BROWSER_ERROR_MESSAGE_LIMIT),
    stack: stack === null ? null : stack.slice(0, BROWSER_ERROR_STACK_LIMIT),
    path: path.slice(0, 500),
  };
}

export function createBrowserErrorReporter(
  send: (input: BrowserErrorInput) => Promise<unknown>,
  path: () => string,
): BrowserErrorReporter {
  const seen = new Set<string>();
  const report = (kind: Kind, value: unknown) => {
    if (seen.size >= BROWSER_ERRORS_PER_PAGE) return;
    const input = browserErrorInput(kind, value, path());
    const key = `${input.message}\n${input.stack ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    void send(input).catch(() => undefined);
  };
  return {
    report,
    watch(target) {
      const onError = (event: Event) =>
        report("error", Reflect.get(event, "error") ?? Reflect.get(event, "message"));
      const onRejection = (event: Event) =>
        report("unhandled-rejection", Reflect.get(event, "reason"));
      target.addEventListener("error", onError);
      target.addEventListener("unhandledrejection", onRejection);
      return () => {
        target.removeEventListener("error", onError);
        target.removeEventListener("unhandledrejection", onRejection);
      };
    },
  };
}
