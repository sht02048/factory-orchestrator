import { useEffect } from "react";
import { reportBrowserError } from "../server/log-functions";
import { createBrowserErrorReporter } from "./browser-errors";
import type { BrowserErrorReporter } from "./browser-errors";

let reporter: BrowserErrorReporter | null = null;

export function browserErrors(): BrowserErrorReporter {
  reporter ??= createBrowserErrorReporter(
    (data) => reportBrowserError({ data }),
    () => window.location.pathname,
  );
  return reporter;
}

export function useBrowserErrorWatch(): void {
  useEffect(() => browserErrors().watch(window), []);
}

export function useReportCaughtError(error: unknown): void {
  useEffect(() => {
    browserErrors().report("error", error);
  }, [error]);
}
