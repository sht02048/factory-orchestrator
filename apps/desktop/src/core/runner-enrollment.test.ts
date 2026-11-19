import { describe, expect, test } from "vitest";
import type { SavedServer } from "./remote.js";
import { RunnerEnrollmentFlow } from "./runner-enrollment.js";
import type { EnrollmentState, RunnerEnrollmentDeps } from "./runner-enrollment.js";
import { START_PROGRESS } from "../shared/enrollment.js";
import type { SetupProgress } from "../shared/enrollment.js";
import type { AcceptResult, RunnerOffer } from "./runner-offer.js";

const SERVER: SavedServer = {
  instanceId: "server-1",
  name: "mac-mini",
  url: "https://mac-mini.example.ts.net",
};
const OFFER: RunnerOffer = { id: "offer-1", expiresInMs: 600_000 };
const DONE: SetupProgress = {
  done: ["remoteLogin", "key", "service", "github", "register"],
  waitingForRemoteLogin: false,
  github: "done",
  problem: null,
};

function world(overrides: Partial<RunnerEnrollmentDeps> = {}) {
  const changes: Array<EnrollmentState | null> = [];
  let offer: RunnerOffer | null | undefined = OFFER;
  let finish: (progress: SetupProgress) => void = () => undefined;
  let report: (progress: SetupProgress) => void = () => undefined;
  const scripts: string[] = [];
  const offerChecks: string[] = [];
  let canceled = 0;
  const flow = new RunnerEnrollmentFlow({
    fetchOffer: async (origin) => {
      offerChecks.push(origin);
      return offer;
    },
    acceptOffer: async (): Promise<AcceptResult> => ({ ok: true, script: "#!/bin/sh\n" }),
    runScript: (script, onProgress) => {
      scripts.push(script);
      report = onProgress;
      return {
        cancel: () => {
          canceled += 1;
        },
        finished: new Promise((resolve) => {
          finish = resolve;
        }),
      };
    },
    isServerMac: async () => false,
    onChange: (state) => changes.push(state),
    ...overrides,
  });
  return {
    flow,
    changes,
    scripts,
    offerChecks,
    setOffer: (next: RunnerOffer | null | undefined) => {
      offer = next;
    },
    finish: (progress: SetupProgress) => finish(progress),
    report: (progress: SetupProgress) => report(progress),
    canceled: () => canceled,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the app's runner enrollment prompt", () => {
  test("asks to register this Mac when the server it is connected to offers it", async () => {
    const w = world();
    await w.flow.tick(SERVER);
    expect(w.flow.state).toEqual({
      server: "mac-mini",
      offerId: "offer-1",
      step: { phase: "ask", accepting: false },
    });
    expect(w.offerChecks).toEqual([SERVER.url]);
  });

  test("never asks the Mac that runs the server, and asks nothing outside remote mode", async () => {
    const serverMac = world({ isServerMac: async () => true });
    await serverMac.flow.tick(SERVER);
    await serverMac.flow.tick(SERVER);
    expect(serverMac.flow.state).toBeNull();
    expect(serverMac.offerChecks).toEqual([]);

    const local = world();
    await local.flow.tick(undefined);
    expect(local.flow.state).toBeNull();
    expect(local.offerChecks).toEqual([]);
  });

  test("cancel before accepting hides only that request, on this Mac only", async () => {
    const w = world();
    await w.flow.tick(SERVER);
    w.flow.cancel();
    expect(w.flow.state).toBeNull();
    await w.flow.tick(SERVER);
    expect(w.flow.state).toBeNull();
    w.setOffer({ id: "offer-2", expiresInMs: 600_000 });
    await w.flow.tick(SERVER);
    expect(w.flow.state?.offerId).toBe("offer-2");
  });

  test("says the request ended when it expires or another Mac takes it", async () => {
    const w = world();
    await w.flow.tick(SERVER);
    w.setOffer(undefined);
    await w.flow.tick(SERVER);
    expect(w.flow.state?.step.phase).toBe("ask");
    w.setOffer(null);
    await w.flow.tick(SERVER);
    expect(w.flow.state?.step).toEqual({ phase: "gone", reason: "ended" });
    w.flow.close();
    expect(w.flow.state).toBeNull();
  });

  test("a new request still shows after an earlier one finished and was never closed", async () => {
    const w = world();
    await w.flow.tick(SERVER);
    const accepting = w.flow.accept();
    await flush();
    w.finish({ ...START_PROGRESS, problem: "orca-not-found" });
    await accepting;
    w.setOffer(OFFER);
    await w.flow.tick(SERVER);
    expect(w.flow.state?.step.phase).toBe("failed");
    w.setOffer({ id: "offer-2", expiresInMs: 600_000 });
    await w.flow.tick(SERVER);
    expect(w.flow.state).toMatchObject({ offerId: "offer-2", step: { phase: "ask" } });
  });

  test("keeps a finished result on screen when the server briefly drops away", async () => {
    const w = world({ acceptOffer: async () => ({ ok: false, gone: null }) });
    await w.flow.tick(SERVER);
    await w.flow.accept();
    await w.flow.tick(undefined);
    expect(w.flow.state?.step.phase).toBe("failed");
  });

  test("checks again whether this is the server Mac until it finds that it is", async () => {
    let answers = [false, true];
    let asked = 0;
    const w = world({
      isServerMac: async () => {
        asked += 1;
        const [next, ...rest] = answers;
        answers = rest;
        return next ?? true;
      },
    });
    await w.flow.tick(SERVER);
    expect(w.flow.state?.step.phase).toBe("ask");
    w.flow.cancel();
    await w.flow.tick(SERVER);
    await w.flow.tick(SERVER);
    expect(asked).toBe(2);
  });

  test("leaving remote mode drops a prompt nobody answered", async () => {
    const w = world();
    await w.flow.tick(SERVER);
    await w.flow.tick(undefined);
    expect(w.flow.state).toBeNull();
  });
});

describe("registering this Mac from the app", () => {
  test("runs the script it got, shows progress, and ends registered", async () => {
    const w = world();
    await w.flow.tick(SERVER);
    const accepting = w.flow.accept();
    expect(w.flow.state?.step).toEqual({ phase: "ask", accepting: true });
    await flush();
    expect(w.scripts).toEqual(["#!/bin/sh\n"]);
    expect(w.flow.state?.step).toEqual({
      phase: "running",
      progress: START_PROGRESS,
      canceling: false,
    });
    const partway = { ...START_PROGRESS, done: ["remoteLogin" as const, "key" as const] };
    w.report(partway);
    expect(w.flow.state?.step).toEqual({ phase: "running", progress: partway, canceling: false });

    w.setOffer(null);
    await w.flow.tick(SERVER);
    expect(w.offerChecks).toHaveLength(1);

    w.finish(DONE);
    await accepting;
    expect(w.flow.state?.step).toEqual({ phase: "registered", progress: DONE });
    await w.flow.tick(SERVER);
    expect(w.flow.state?.step.phase).toBe("registered");
    w.flow.close();
    expect(w.flow.state).toBeNull();
  });

  test("shows the failure the script reported", async () => {
    const w = world();
    await w.flow.tick(SERVER);
    const accepting = w.flow.accept();
    await flush();
    const failed = {
      ...START_PROGRESS,
      done: ["remoteLogin" as const],
      problem: "service-failed" as const,
    };
    w.finish(failed);
    await accepting;
    expect(w.flow.state?.step).toEqual({ phase: "failed", progress: failed });
  });

  test("cancel while running stops the script and ends with canceled", async () => {
    const w = world();
    await w.flow.tick(SERVER);
    const accepting = w.flow.accept();
    await flush();
    w.flow.cancel();
    w.flow.cancel();
    expect(w.canceled()).toBe(1);
    expect(w.flow.state?.step).toMatchObject({ phase: "running", canceling: true });
    w.finish({ ...START_PROGRESS, problem: "canceled" });
    await accepting;
    expect(w.flow.state?.step).toMatchObject({
      phase: "failed",
      progress: { problem: "canceled" },
    });
  });

  test("says another Mac took the request first", async () => {
    const w = world({ acceptOffer: async () => ({ ok: false, gone: "taken" }) });
    await w.flow.tick(SERVER);
    await w.flow.accept();
    expect(w.flow.state?.step).toEqual({ phase: "gone", reason: "taken" });
    expect(w.scripts).toEqual([]);
  });

  test("says the server could not start when accept fails for another reason", async () => {
    const w = world({ acceptOffer: async () => ({ ok: false, gone: null }) });
    await w.flow.tick(SERVER);
    await w.flow.accept();
    expect(w.flow.state?.step).toEqual({
      phase: "failed",
      progress: { ...START_PROGRESS, problem: "server-unavailable" },
    });
  });
});
