import { describe, expect, it } from "vitest";
import { diagnosticsHref, diagnosticsRequest } from "./model.js";
import { runModeOf } from "./run-mode.js";

describe("run mode", () => {
  it.each([
    [{ ELECTRON_RUN_AS_NODE: "1", GANGER_HOME: "/h" }, "desktop"],
    [{ INVOCATION_ID: "abc", GANGER_HOME: "/h" }, "systemd"],
    [{ XPC_SERVICE_NAME: "ganger", GANGER_HOME: "/h" }, "launchd"],
    [{ XPC_SERVICE_NAME: "0", GANGER_HOME: "/h" }, "terminal"],
    [{}, "development"],
  ] as const)("reads %o as %s", (env, mode) => {
    expect(runModeOf(env, "ganger")).toBe(mode);
  });
});

describe("diagnostics request", () => {
  it("anonymizes unless asked not to and round trips the chosen run", () => {
    expect(diagnosticsHref({ anonymize: true, runId: null })).toBe("/api/diagnostics");
    const href = diagnosticsHref({ anonymize: false, runId: "run 1" });
    expect(diagnosticsRequest(new URL(href, "http://localhost"))).toEqual({
      anonymize: false,
      runId: "run 1",
    });
    expect(diagnosticsRequest(new URL("http://localhost/api/diagnostics?anonymize=yes"))).toEqual({
      anonymize: true,
      runId: null,
    });
  });
});
