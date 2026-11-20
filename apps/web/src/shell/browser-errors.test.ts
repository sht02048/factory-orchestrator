import { describe, expect, it } from "vitest";
import type { BrowserErrorInput } from "@ganger/app/diagnostics/model";
import { BROWSER_ERRORS_PER_PAGE, createBrowserErrorReporter } from "./browser-errors";

function fakeWindow() {
  const target = new EventTarget();
  return {
    target,
    fireError: (error: unknown, message = "") => {
      const event = new Event("error");
      Object.assign(event, { error, message });
      target.dispatchEvent(event);
    },
    fireRejection: (reason: unknown) => {
      const event = new Event("unhandledrejection");
      Object.assign(event, { reason });
      target.dispatchEvent(event);
    },
  };
}

describe("browser error reporter", () => {
  it("sends uncaught errors and unhandled rejections once each with the page path", () => {
    const sent: BrowserErrorInput[] = [];
    const reporter = createBrowserErrorReporter(
      (input) => {
        sent.push(input);
        return Promise.resolve();
      },
      () => "/runs",
    );
    const page = fakeWindow();
    const stop = reporter.watch(page.target);
    const boom = new TypeError("x is undefined");
    page.fireError(boom);
    page.fireError(boom);
    page.fireRejection("network down");
    stop();
    page.fireError(new Error("after stop"));
    expect(sent).toEqual([
      expect.objectContaining({
        kind: "error",
        message: "TypeError: x is undefined",
        path: "/runs",
      }),
      { kind: "unhandled-rejection", message: "network down", stack: null, path: "/runs" },
    ]);
    expect(sent[0]?.stack).toContain("x is undefined");
  });

  it("stops after a fixed number of distinct errors per page and ignores send failures", async () => {
    let calls = 0;
    const reporter = createBrowserErrorReporter(
      () => {
        calls += 1;
        return Promise.reject(new Error("offline"));
      },
      () => "/",
    );
    for (let index = 0; index < BROWSER_ERRORS_PER_PAGE + 5; index += 1) {
      reporter.report("error", new Error(`error ${index}`));
    }
    await Promise.resolve();
    expect(calls).toBe(BROWSER_ERRORS_PER_PAGE);
  });
});
