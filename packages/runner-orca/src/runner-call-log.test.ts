import { memoryLogger } from "@ganger/log/testing";
import { describe, expect, it } from "vitest";
import { parseOrcaRunnerConfig } from "./config.js";
import { OrcaRunner } from "./orca-runner.js";
import { describeRunnerCall, logRunnerCall } from "./runner-call-log.js";
import { own, ScriptedExec, stdout } from "./test-support.js";

const ORCA = "orca";

function runnerLogging(exec: ScriptedExec) {
  const logger = memoryLogger();
  const runner = new OrcaRunner(parseOrcaRunnerConfig({ sshTarget: "runner.example.com" }), exec, {
    sleep: () => Promise.resolve(),
    logger: () => logger,
  });
  return { runner, logger };
}

describe("describeRunnerCall", () => {
  it("names the orca verb by its first two words and marks reads", () => {
    expect(describeRunnerCall([ORCA, "terminal", "show", "--terminal", "t1"], ORCA)).toEqual({
      verb: "terminal show",
      write: false,
    });
    expect(describeRunnerCall([ORCA, "status", "--json"], ORCA)).toEqual({
      verb: "status",
      write: false,
    });
  });

  it("marks writes and keeps the orca run id and worktree name of worker-start", () => {
    expect(
      describeRunnerCall(
        [
          ORCA,
          "orchestration",
          "worker-start",
          "--run",
          "orca-run-1",
          "--name",
          "ganger-ACME-1-1",
          "--json",
        ],
        ORCA,
      ),
    ).toEqual({
      verb: "orchestration worker-start",
      write: true,
      orcaRunId: "orca-run-1",
      worktreeName: "ganger-ACME-1-1",
    });
  });

  it("names non-orca commands by the program alone so their arguments stay out", () => {
    expect(
      describeRunnerCall(["env", "GIT_TERMINAL_PROMPT=0", "git", "-C", "/srv/repo"], ORCA),
    ).toEqual({ verb: "git", write: false });
  });
});

describe("runner call line", () => {
  it("writes reads at debug with time and outcome", async () => {
    const exec = new ScriptedExec().orca("status", stdout(own("status-ready.json")));
    const { runner, logger } = runnerLogging(exec);
    await runner.checkHealth();
    const call = logger.entries.find((entry) => entry.event === "runner.call");
    expect(call).toMatchObject({
      level: "debug",
      fields: { verb: "status", exit: 0, outcome: "ok" },
    });
    expect(typeof call?.fields.ms).toBe("number");
  });

  it("writes write verbs at info and records unreachable runners", () => {
    const logger = memoryLogger();
    logRunnerCall(logger, { verb: "terminal close", write: true }, 12.4, {
      kind: "result",
      result: {
        exitCode: 255,
        stdout: "",
        stderr: "ssh: connect to host runner.example.com port 22: Connection refused",
        timedOut: false,
      },
    });
    logRunnerCall(logger, { verb: "orchestration worker-stop", write: true }, 3, {
      kind: "result",
      result: {
        exitCode: 0,
        stdout: JSON.stringify({ ok: false, error: { code: "not_found" } }),
        stderr: "",
        timedOut: false,
      },
    });
    expect(logger.entries.map((entry) => [entry.level, entry.fields])).toEqual([
      [
        "info",
        {
          verb: "terminal close",
          ms: 12,
          exit: 255,
          outcome: "unreachable",
          reason: "ssh: connect to host runner.example.com port 22: Connection refused",
        },
      ],
      [
        "info",
        { verb: "orchestration worker-stop", ms: 3, exit: 0, outcome: "runner-error:not_found" },
      ],
    ]);
  });

  it("never writes the stdin brief or the stdout body", async () => {
    const exec = new ScriptedExec().orca(
      "status",
      stdout(JSON.stringify({ ok: true, result: { secretTicketBody: "do not log me" } })),
    );
    const { runner, logger } = runnerLogging(exec);
    await runner.checkHealth();
    expect(JSON.stringify(logger.entries)).not.toContain("do not log me");
  });
});
