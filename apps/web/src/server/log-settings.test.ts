import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, useLogger } from "@ganger/log";
import { afterEach, describe, expect, it } from "vitest";
import { installHome, recordBrowserError, saveDebugLog } from "./log-settings";

const dirs: string[] = [];
const restores: Array<() => void> = [];
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function captureLog(): string[] {
  const texts: string[] = [];
  restores.push(
    useLogger(
      createLogger({
        proc: "web",
        version: "0",
        level: () => "info",
        sinks: [{ write: (_line, text) => texts.push(text) }],
      }),
    ),
  );
  return texts;
}

describe("debug log switch on the web server", () => {
  it("writes the switch into the install home and refuses without one", () => {
    const home = mkdtempSync(join(tmpdir(), "ganger-web-log-"));
    dirs.push(home);
    expect(saveDebugLog({ GANGER_HOME: home }, true)).toEqual({ ok: true });
    expect(readFileSync(join(home, "logging.json"), "utf8")).toBe('{"debug":true}\n');
    expect(saveDebugLog({}, true)).toEqual({ ok: false, reason: "unavailable" });
    expect(installHome({ GANGER_HOME: "relative/home" })).toBeNull();
  });
});

describe("browser errors", () => {
  it("writes one error line with the page path and scrubs tokens from message and stack", () => {
    const texts = captureLog();
    recordBrowserError(
      {
        kind: "error",
        message: "TypeError: fetch failed with Bearer abcdefghijklmnop1234",
        stack: "TypeError: x\n    at lin_api_0123456789abcdefABCDEF (app.js:1:2)",
        path: "/runs",
      },
      1_000_000,
    );
    expect(texts).toHaveLength(1);
    const line: unknown = JSON.parse(texts[0] ?? "");
    expect(line).toMatchObject({
      level: "error",
      event: "browser.error",
      msg: "the browser reported an error",
      kind: "error",
      path: "/runs",
      err: { name: "BrowserError" },
    });
    expect(texts[0]).not.toContain("abcdefghijklmnop1234");
    expect(texts[0]).not.toContain("lin_api_0123");
  });

  it("drops a flood of browser errors after a limit each minute", () => {
    const texts = captureLog();
    const report = (at: number) =>
      recordBrowserError({ kind: "error", message: "boom", stack: null, path: "/" }, at);
    for (let index = 0; index < 50; index += 1) report(5_000_000);
    expect(texts).toHaveLength(30);
    report(5_000_000 + 60_000);
    expect(texts).toHaveLength(31);
  });
});
