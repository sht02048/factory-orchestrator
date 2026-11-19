import { describe, expect, test } from "vitest";
import type { Probe } from "./identity.js";
import { START_PROGRESS } from "../shared/enrollment.js";
import type { SetupProgress } from "../shared/enrollment.js";
import {
  acceptOffer,
  fetchOffer,
  isServerMac,
  nextProgress,
  parseProgressLine,
  runSetupScript,
  setupEnv,
} from "./runner-offer.js";

const ORIGIN = "https://ganger.example.ts.net";
const OFFER_ID = "6f1c2c43-6a0f-4a43-9f61-2f3c1d1b5e0a";

function fakeFetch(status: number, body: unknown, seen: Request[] = []): typeof fetch {
  return async (input, init) => {
    seen.push(new Request(input, init));
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
}

describe("asking the server for a runner enrollment offer", () => {
  test("reads an open offer and no offer", async () => {
    expect(
      await fetchOffer(ORIGIN, fakeFetch(200, { offer: { id: OFFER_ID, expiresInMs: 5000 } })),
    ).toEqual({ id: OFFER_ID, expiresInMs: 5000 });
    expect(await fetchOffer(ORIGIN, fakeFetch(200, { offer: null }))).toBeNull();
  });

  test("treats an unreadable answer as unknown, not as no offer", async () => {
    expect(await fetchOffer(ORIGIN, fakeFetch(200, { offer: { id: 1 } }))).toBeUndefined();
    expect(await fetchOffer(ORIGIN, fakeFetch(403, "Blocked request"))).toBeUndefined();
    expect(
      await fetchOffer(ORIGIN, async () => {
        throw new Error("offline");
      }),
    ).toBeUndefined();
  });

  test("accepts with the offer id and gets the setup script once", async () => {
    const seen: Request[] = [];
    const result = await acceptOffer(
      ORIGIN,
      OFFER_ID,
      fakeFetch(200, { ok: true, script: "#!/bin/sh\n" }, seen),
    );
    expect(result).toEqual({ ok: true, script: "#!/bin/sh\n" });
    expect(seen[0]?.method).toBe("POST");
    expect(seen[0]?.url).toBe(`${ORIGIN}/api/runner-enrollment/offer/accept`);
    expect(await seen[0]?.json()).toEqual({ id: OFFER_ID });
  });

  test("names why an offer is gone and hides anything else", async () => {
    expect(
      await acceptOffer(ORIGIN, OFFER_ID, fakeFetch(410, { ok: false, reason: "taken" })),
    ).toEqual({ ok: false, gone: "taken" });
    expect(
      await acceptOffer(ORIGIN, OFFER_ID, fakeFetch(503, { ok: false, reason: "no-home" })),
    ).toEqual({ ok: false, gone: null });
    expect(await acceptOffer(ORIGIN, OFFER_ID, fakeFetch(500, "oops"))).toEqual({
      ok: false,
      gone: null,
    });
  });
});

describe("progress lines from the setup script", () => {
  test("reads steps, the GitHub result and failures, and ignores other lines", () => {
    expect(parseProgressLine("ganger-step:key")).toEqual({ kind: "step", step: "key" });
    expect(parseProgressLine("ganger-github:gh-missing")).toEqual({
      kind: "github",
      result: "gh-missing",
    });
    expect(parseProgressLine("ganger-fail:orca-not-found")).toEqual({
      kind: "fail",
      problem: "orca-not-found",
    });
    expect(parseProgressLine("ganger-fail:something-new")).toEqual({
      kind: "fail",
      problem: "script-failed",
    });
    expect(parseProgressLine("ganger-step:unknown")).toBeNull();
    expect(parseProgressLine("  - Found Orca at /Applications/Orca.app")).toBeNull();
  });

  test("marks steps done in order and tracks the Remote Login wait", () => {
    const steps = [
      parseProgressLine("ganger-step:remote-login-wait"),
      parseProgressLine("ganger-step:remote-login"),
      parseProgressLine("ganger-step:key"),
    ];
    const waiting = nextProgress(START_PROGRESS, { kind: "step", step: "remote-login-wait" });
    expect(waiting.waitingForRemoteLogin).toBe(true);
    const progress = steps.reduce<SetupProgress>(
      (acc, event) => (event === null ? acc : nextProgress(acc, event)),
      START_PROGRESS,
    );
    expect(progress).toEqual({
      done: ["remoteLogin", "key"],
      waitingForRemoteLogin: false,
      github: null,
      problem: null,
    });
  });
});

describe("running the setup script", () => {
  test("turns on progress lines and adds the usual tool folders to PATH", () => {
    const env = setupEnv({ PATH: "/usr/bin:/bin", HOME: "/Users/example" });
    expect(env["GANGER_PROGRESS"]).toBe("1");
    expect(env["PATH"]?.split(":")).toEqual([
      "/usr/bin",
      "/bin",
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/sbin",
      "/sbin",
    ]);
    expect(env["HOME"]).toBe("/Users/example");
  });

  test("passes the script on stdin, so its contents never show in the process list", async () => {
    const secret = "token-never-in-args";
    const seen: SetupProgress[] = [];
    const run = runSetupScript(
      [
        `GANGER_TOKEN='${secret}'`,
        `args=$(ps -o args= -p $$)`,
        `case "$args" in *"$GANGER_TOKEN"*) exit 9 ;; esac`,
        `[ "$GANGER_PROGRESS" = 1 ] || exit 8`,
        "for step in remote-login key service github report; do",
        "  printf 'ganger-step:%s\\n' \"$step\"",
        "done",
      ].join("\n"),
      (progress) => seen.push(progress),
    );
    const finished = await run.finished;
    expect(finished.problem).toBeNull();
    expect(finished.done).toEqual(["remoteLogin", "key", "service", "github", "register"]);
    expect(seen).toHaveLength(5);
  });

  test("reports the script's own failure, or a generic one when it stops without saying", async () => {
    const named = await runSetupScript(
      "printf 'ganger-step:remote-login\\nganger-fail:service-failed\\n'; exit 1",
      () => undefined,
    ).finished;
    expect(named).toMatchObject({ done: ["remoteLogin"], problem: "service-failed" });
    const silent = await runSetupScript("exit 3", () => undefined).finished;
    expect(silent.problem).toBe("script-failed");
    const unfinished = await runSetupScript("exit 0", () => undefined).finished;
    expect(unfinished.problem).toBe("script-failed");
  });

  test("cancel stops the whole script, and the script's own trap reports canceled", async () => {
    const run = runSetupScript(
      [
        "trap 'printf \"ganger-fail:canceled\\n\"; exit 130' TERM",
        "printf 'ganger-step:remote-login-wait\\n'",
        "while :; do sleep 0.05; done",
      ].join("\n"),
      (progress) => {
        if (progress.waitingForRemoteLogin) run.cancel();
      },
    );
    const finished = await run.finished;
    expect(finished.problem).toBe("canceled");
  });
});

describe("not asking the Mac that runs the server", () => {
  const probeWith =
    (instanceId: string | null, seen: string[] = []): Probe =>
    async (origin) => {
      seen.push(origin);
      return instanceId === null
        ? { kind: "unreachable" }
        : {
            kind: "ours",
            identity: { product: "ganger", version: "0.1.0", instanceId, webAccess: "allowed" },
          };
    };
  const server = { instanceId: "server-1", name: "mac-mini", url: ORIGIN };

  test("a loopback address is this Mac", async () => {
    const seen: string[] = [];
    expect(
      await isServerMac({ ...server, url: "http://127.0.0.1:3000" }, probeWith(null, seen), [3000]),
    ).toBe(true);
    expect(seen).toEqual([]);
  });

  test("a server answering on this Mac's loopback with the same instance is this Mac", async () => {
    const seen: string[] = [];
    expect(await isServerMac(server, probeWith("server-1", seen), [3000])).toBe(true);
    expect(seen).toEqual(["http://127.0.0.1:3000"]);
    expect(await isServerMac(server, probeWith("server-2"), [3000])).toBe(false);
    expect(await isServerMac(server, probeWith(null), [3000])).toBe(false);
  });

  test("also looks at the port in the saved address", async () => {
    const seen: string[] = [];
    await isServerMac(
      { ...server, url: "http://mac-mini.example.ts.net:4000" },
      probeWith(null, seen),
      [3000],
    );
    expect(seen).toEqual(["http://127.0.0.1:3000", "http://127.0.0.1:4000"]);
  });
});
