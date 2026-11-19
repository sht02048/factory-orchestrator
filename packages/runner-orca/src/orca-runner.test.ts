import {
  AdapterError,
  blockedProjectsOf,
  isAssignmentBlocked,
  toAgentId,
  toMailboxRef,
  toPermissionRequestId,
  toQuestionId,
  toRunnerProjectId,
  toTicketKey,
  toWorktreeRef,
} from "@ganger/core";
import type { RunOnRunner } from "@ganger/core";
import { describe, expect, test } from "vitest";
import { OrcaRunnerConfigError } from "./config.js";
import {
  LOG_CUT_MARKER,
  LOG_MAX_PAGES,
  MAILBOX_TITLE,
  ORCA_RUNNER_KIND,
  orcaRunnerFactory,
} from "./orca-runner.js";
import { decodeAgent, decodeMailbox, encodeAgent, encodeMailbox } from "./refs.js";
import {
  ScriptedExec,
  own,
  peekOf,
  processResult,
  research,
  runnerWith,
  stdout,
} from "./test-support.js";

const MAILBOX = encodeMailbox({
  terminal: "term_41ac5f6b-daad-43f3-9264-9e25ddd24ef7",
  runId: "run_493ebb2f403d",
});
const WORKTREE = toWorktreeRef(
  "527aed9b-0eef-4404-9d8d-9a89d7fb1dc9::<path>/workspaces/sandbox/fo-t0013-probe1",
);
const RUN: RunOnRunner = {
  mailbox: MAILBOX,
  worktree: WORKTREE,
  agentRef: encodeAgent({
    dispatchId: "ctx_a6e6a23a7132",
    taskId: "task_43a3a070dc4c",
    runId: "run_493ebb2f403d",
  }),
};

const BROKEN = stdout("Error: something went wrong before JSON\n", 1);

async function adapterError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AdapterError) {
      const detail: unknown = error.detail;
      return detail;
    }
    throw error;
  }
  throw new Error("expected an AdapterError");
}

function withProjects(exec: ScriptedExec): ScriptedExec {
  return exec
    .orca("project list", stdout(own("project-list.json")))
    .orca("project setups", stdout(own("project-setups.json")));
}

function expectNoConsumingCheck(exec: ScriptedExec): void {
  const consuming = exec
    .commands()
    .filter((command) => command.includes(" orchestration check ") && !command.includes(" --peek"));
  expect(consuming).toEqual([]);
}

describe("orcaRunnerFactory", () => {
  test("creates an orca runner from stored settings", () => {
    const runner = orcaRunnerFactory.create({ sshTarget: "runner.example.com" });
    expect(runner.kind).toBe(ORCA_RUNNER_KIND);
  });

  test("rejects settings without an ssh target or with an ssh option as target", () => {
    expect(() => orcaRunnerFactory.create({})).toThrow(OrcaRunnerConfigError);
    expect(() => orcaRunnerFactory.create({ sshTarget: "-oProxyCommand=x" })).toThrow(
      OrcaRunnerConfigError,
    );
  });
});

describe("checkHealth", () => {
  const ORIGIN_ONLY = stdout("remote.origin.url https://github.com/acme/sandbox.git\n");
  const FORK = stdout(
    [
      "remote.origin.url https://github.com/someone/sandbox.git",
      "remote.origin.fetch +refs/heads/*:refs/remotes/origin/*",
      "remote.upstream.url https://github.com/acme/sandbox.git",
      "",
    ].join("\n"),
  );

  function onlineWith(...push: Parameters<ScriptedExec["on"]>[1][]): ScriptedExec {
    return withProjects(
      new ScriptedExec()
        .orca("status", stdout(own("status-ready.json")))
        .orca("serve service status", stdout(own("serve-service-status-live.json")))
        .on("git -C ", ORIGIN_ONLY)
        .on("env ", ...push),
    );
  }

  test("is online with the service and GitHub push access on every project", async () => {
    const exec = onlineWith(processResult(own("push-dry-run-ok.json")));
    const health = await runnerWith(exec).checkHealth();
    expect(health).toMatchObject({ online: true, version: "1.4.258", error: null });
    expect(health.prerequisites).toEqual([
      expect.objectContaining({ id: "orca-service", satisfied: true, blocksAssignment: false }),
      expect.objectContaining({
        id: "github-push:github:acme/sandbox",
        satisfied: true,
        blocksAssignment: false,
        project: "github:acme/sandbox",
      }),
    ]);
    expect(health.prerequisites[1]).not.toHaveProperty("failure");
    expect(isAssignmentBlocked(health)).toBe(false);
    expect(exec.commands().filter((c) => c.startsWith("git ") || c.startsWith("env "))).toEqual([
      "git -C '<path>/sandbox' config --get-regexp '^remote\\.'",
      "env 'GIT_TERMINAL_PROMPT=0' 'GIT_SSH_COMMAND=ssh -o BatchMode=yes' git -C '<path>/sandbox' push --dry-run --porcelain --no-verify origin HEAD:refs/heads/ganger/push-check",
    ]);
  });

  test("a failed push blocks only its project, with the reason and an auth kind", async () => {
    const failed = processResult(own("push-dry-run-no-credentials.json"));
    const sleeps: number[] = [];
    const exec = onlineWith(failed, failed);
    const health = await runnerWith(exec, {}, sleeps).checkHealth();
    expect(health.online).toBe(true);
    expect(health.error).toBeNull();
    expect(health.prerequisites[1]).toMatchObject({
      satisfied: false,
      blocksAssignment: false,
      project: "github:acme/sandbox",
      failure: {
        kind: "auth",
        reason:
          "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      },
    });
    expect(isAssignmentBlocked(health)).toBe(false);
    expect(blockedProjectsOf(health.prerequisites)).toEqual(["github:acme/sandbox"]);
    expect(sleeps).toEqual([1000]);
    expect(exec.commands().filter((c) => c.startsWith("env "))).toHaveLength(2);
  });

  test("a push that fails once and passes on the retry is satisfied", async () => {
    const exec = onlineWith(
      processResult(own("push-dry-run-no-credentials.json")),
      processResult(own("push-dry-run-ok.json")),
    );
    const health = await runnerWith(exec).checkHealth();
    expect(health.prerequisites[1]).toMatchObject({ satisfied: true });
    expect(health.prerequisites[1]).not.toHaveProperty("failure");
  });

  test("a fork checks the push remote git would use, not the project's upstream remote", async () => {
    const upstream = own("project-list.json").replace(
      '"remoteName": "origin"',
      '"remoteName": "upstream"',
    );
    expect(upstream).toContain('"remoteName": "upstream"');
    const exec = new ScriptedExec()
      .orca("status", stdout(own("status-ready.json")))
      .orca("serve service status", stdout(own("serve-service-status-live.json")))
      .orca("project list", stdout(upstream))
      .orca("project setups", stdout(own("project-setups.json")))
      .on("git -C ", FORK)
      .on("env ", processResult(own("push-dry-run-ok.json")));
    await runnerWith(exec).checkHealth();
    const push = exec.commands().find((c) => c.startsWith("env "));
    expect(push).toContain(" origin HEAD:refs/heads/ganger/push-check");
  });

  test("an ssh failure during the push check is unknown, not broken", async () => {
    const unreachable = processResult(own("ssh-unreachable.json"));
    const exec = onlineWith(unreachable, unreachable);
    const health = await runnerWith(exec).checkHealth();
    expect(health.prerequisites[1]).toMatchObject({
      satisfied: null,
      failure: { kind: "network" },
    });
    expect(blockedProjectsOf(health.prerequisites)).toEqual([]);
  });

  test("a push that times out twice is unknown with a timeout kind", async () => {
    const timedOut = { exitCode: null, stdout: "", stderr: "", timedOut: true };
    const exec = onlineWith(timedOut, timedOut);
    const health = await runnerWith(exec).checkHealth();
    expect(health.prerequisites[1]).toMatchObject({
      satisfied: null,
      failure: { kind: "timeout", reason: null },
    });
  });

  test("is offline when the runtime is off and reports a missing service", async () => {
    const exec = new ScriptedExec()
      .orca("status", stdout(research("0003/status-runtime-off.json")))
      .orca("serve service status", stdout(research("0003/serve-service-status-uninstalled.json")));
    const health = await runnerWith(exec).checkHealth();
    expect(health.online).toBe(false);
    expect(health.error).toMatchObject({ kind: "not-ready" });
    expect(health.prerequisites).toEqual([
      expect.objectContaining({ id: "orca-service", satisfied: false }),
    ]);
  });

  test("ok: false from status is reported as the runner error", async () => {
    const exec = new ScriptedExec().orca(
      "status",
      stdout(research("0003/worktree-ps-runtime-off.json"), 1),
    );
    const health = await runnerWith(exec).checkHealth();
    expect(health.online).toBe(false);
    expect(health.error).toMatchObject({ kind: "not-ready" });
  });

  test("tells an unreachable runner, a missing orca and broken output apart", async () => {
    const unreachable = new ScriptedExec().orca(
      "status",
      processResult(own("ssh-unreachable.json")),
    );
    expect((await runnerWith(unreachable).checkHealth()).error).toMatchObject({
      kind: "unreachable",
    });
    const notInstalled = new ScriptedExec().orca(
      "status",
      processResult(own("orca-not-found.json")),
    );
    expect((await runnerWith(notInstalled).checkHealth()).error).toMatchObject({
      kind: "not-installed",
    });
    const broken = new ScriptedExec().orca("status", BROKEN);
    const health = await runnerWith(broken).checkHealth();
    expect(health.online).toBe(false);
    expect(health.error).toMatchObject({ kind: "malformed-output" });
  });
});

describe("listProjects", () => {
  test("lists runner-side projects with their setup state", async () => {
    const projects = await runnerWith(withProjects(new ScriptedExec())).listProjects();
    expect(projects).toEqual([
      { id: toRunnerProjectId("github:acme/sandbox"), displayName: "sandbox", setupState: "ready" },
    ]);
  });

  test("reads the research 0004 project list", async () => {
    const exec = new ScriptedExec()
      .orca("project list", stdout(research("0004/project-list.json")))
      .orca("project setups", stdout(research("0004/project-setups.json")));
    expect(await runnerWith(exec).listProjects()).toEqual([
      { id: "github:acme/sandbox", displayName: "sandbox", setupState: "ready" },
    ]);
  });

  test("ok: false and broken output become error kinds", async () => {
    const off = new ScriptedExec().orca(
      "project list",
      stdout(research("0003/worktree-ps-runtime-off.json"), 1),
    );
    expect(await adapterError(runnerWith(off).listProjects())).toMatchObject({
      kind: "not-ready",
    });
    const broken = new ScriptedExec().orca("project list", BROKEN);
    expect(await adapterError(runnerWith(broken).listProjects())).toMatchObject({
      kind: "malformed-output",
    });
  });
});

describe("ensureMailbox", () => {
  test("creates a mailbox terminal and a Run when there is none", async () => {
    const exec = withProjects(
      new ScriptedExec()
        .orca("terminal create", stdout(own("terminal-create-mailbox.json")))
        .orca("orchestration run-create", stdout(own("run-create.json"))),
    );
    const mailbox = await runnerWith(exec).ensureMailbox(null);
    expect(decodeMailbox(mailbox)).toEqual({
      terminal: "term_41ac5f6b-daad-43f3-9264-9e25ddd24ef7",
      runId: "run_493ebb2f403d",
    });
    expect(exec.commands()).toContain(
      `/Applications/Orca.app/Contents/Resources/bin/orca terminal create --worktree 'path:<path>/sandbox' --title ${MAILBOX_TITLE} --command 'cat > /dev/null' --json`,
    );
    expect(exec.commands()).toContain(
      "/Applications/Orca.app/Contents/Resources/bin/orca orchestration run-create --objective ganger --from term_41ac5f6b-daad-43f3-9264-9e25ddd24ef7 --json",
    );
  });

  test("keeps a live mailbox as it is", async () => {
    const exec = new ScriptedExec()
      .orca("terminal show", stdout(own("terminal-show-live.json")))
      .orca("orchestration run-current", stdout(own("run-current-bound.json")));
    expect(await runnerWith(exec).ensureMailbox(MAILBOX)).toBe(MAILBOX);
    expect(exec.commands()).toHaveLength(2);
  });

  test("binds a live mailbox terminal that lost its Run again instead of making a new one", async () => {
    const exec = new ScriptedExec()
      .orca("terminal show", stdout(own("terminal-show-live.json")))
      .orca("orchestration run-current", stdout(own("run-current-unbound.json")))
      .orca("orchestration run-use", stdout(own("run-use.json")));
    expect(await runnerWith(exec).ensureMailbox(MAILBOX)).toBe(MAILBOX);
    expect(exec.commands()).toContain(
      "/Applications/Orca.app/Contents/Resources/bin/orca orchestration run-use --id run_493ebb2f403d --from term_41ac5f6b-daad-43f3-9264-9e25ddd24ef7 --json",
    );
    expect(exec.commands().some((c) => c.includes("terminal create"))).toBe(false);
  });

  test("recreates a closed mailbox terminal and keeps using the same Run", async () => {
    const newHandle = "term_a0b2cd2f-0a8c-4e46-9e43-f66cc1145de8";
    const exec = withProjects(
      new ScriptedExec()
        .orca("terminal show", stdout(own("terminal-show-closed.json")))
        .orca(
          "terminal create",
          stdout(JSON.stringify({ ok: true, result: { terminal: { handle: newHandle } } })),
        )
        .orca("orchestration run-use", stdout(own("run-use.json"))),
    );
    const mailbox = await runnerWith(exec).ensureMailbox(MAILBOX);
    expect(mailbox).not.toBe(MAILBOX);
    expect(decodeMailbox(mailbox)).toEqual({ terminal: newHandle, runId: "run_493ebb2f403d" });
    expect(exec.commands()).toContain(
      `/Applications/Orca.app/Contents/Resources/bin/orca orchestration run-use --id run_493ebb2f403d --from ${newHandle} --json`,
    );
  });

  test("recreates a mailbox whose handle is stale and makes a new Run when the old one is gone", async () => {
    const exec = withProjects(
      new ScriptedExec()
        .orca("terminal show", stdout(own("terminal-show-stale.json"), 1))
        .orca("terminal create", stdout(own("terminal-create-mailbox.json")))
        .orca(
          "orchestration run-use",
          stdout(JSON.stringify({ ok: false, error: { code: "not_found", message: "no run" } }), 1),
        )
        .orca("orchestration run-create", stdout(own("run-create.json"))),
    );
    const mailbox = await runnerWith(exec).ensureMailbox(
      encodeMailbox({ terminal: "term_gone", runId: "run_gone" }),
    );
    expect(decodeMailbox(mailbox)).toEqual({
      terminal: "term_41ac5f6b-daad-43f3-9264-9e25ddd24ef7",
      runId: "run_493ebb2f403d",
    });
  });

  test("treats a value it did not make as no mailbox", async () => {
    const exec = withProjects(
      new ScriptedExec()
        .orca("terminal create", stdout(own("terminal-create-mailbox.json")))
        .orca("orchestration run-create", stdout(own("run-create.json"))),
    );
    const mailbox = await runnerWith(exec).ensureMailbox(toMailboxRef("fake-mailbox-1"));
    expect(decodeMailbox(mailbox)?.runId).toBe("run_493ebb2f403d");
  });

  test("closes the new terminal when no Run can be bound, and reports broken output", async () => {
    const exec = withProjects(
      new ScriptedExec()
        .orca("terminal create", stdout(own("terminal-create-mailbox.json")))
        .orca("orchestration run-create", BROKEN)
        .orca("terminal close", stdout(own("terminal-close.json"))),
    );
    expect(await adapterError(runnerWith(exec).ensureMailbox(null))).toMatchObject({
      kind: "malformed-output",
    });
    expect(exec.commands().some((c) => c.includes(" terminal close --terminal "))).toBe(true);
  });
});

describe("startRun", () => {
  const input = {
    mailbox: MAILBOX,
    project: toRunnerProjectId("github:acme/sandbox"),
    worktreeName: "fo-t0013-probe1",
    agent: toAgentId("claude"),
    prompt: `Fix "the bug"\nin it's $HOME \`code\``,
    ticket: { key: toTicketKey("ENG-1"), url: "https://linear.app/acme/issue/ENG-1" },
  };

  test("starts a worker with the ticket on stdin and returns the runner's branch", async () => {
    const exec = withProjects(
      new ScriptedExec()
        .orca("orchestration worker-start", stdout(own("worker-start-spec-stdin.json")))
        .orca("worktree show", stdout(own("worktree-show.json"))),
    );
    const started = await runnerWith(exec).startRun(input);
    expect(started.worktree).toBe(WORKTREE);
    expect(started.branch).toBe("acme/fo-t0013-probe1");
    expect(decodeAgent(started.agentRef)).toEqual({
      dispatchId: "ctx_a6e6a23a7132",
      taskId: "task_43a3a070dc4c",
      runId: "run_493ebb2f403d",
    });
    const start = exec.calls.find((c) => c.command.includes("worker-start"));
    expect(start?.stdin).toBe(input.prompt);
    expect(start?.command).toBe(
      "/Applications/Orca.app/Contents/Resources/bin/orca orchestration worker-start --from term_41ac5f6b-daad-43f3-9264-9e25ddd24ef7 --run run_493ebb2f403d --spec-file - --task-title fo-t0013-probe1 --worktree new-top-level --repo id:527aed9b-0eef-4404-9d8d-9a89d7fb1dc9 --name fo-t0013-probe1 --agent claude --comment 'ENG-1 https://linear.app/acme/issue/ENG-1' --json",
    );
    expect(exec.commands()).toContain(
      `/Applications/Orca.app/Contents/Resources/bin/orca worktree show --worktree 'id:${WORKTREE}' --json`,
    );
  });

  describe("--model (0043)", () => {
    async function startCommand(
      runInput: typeof input & { model?: string },
      config: { model?: string } = {},
    ): Promise<string | undefined> {
      const exec = withProjects(
        new ScriptedExec()
          .orca("orchestration worker-start", stdout(own("worker-start-spec-stdin.json")))
          .orca("worktree show", stdout(own("worktree-show.json"))),
      );
      await runnerWith(exec, config).startRun(runInput);
      return exec.calls.find((c) => c.command.includes("worker-start"))?.command;
    }

    test("passes the run's model (the Mapping's) to worker-start", async () => {
      expect(await startCommand({ ...input, model: "sonnet" })).toContain(
        " --agent claude --model sonnet --comment ",
      );
    });

    test("the run's model wins over the runner configuration's model", async () => {
      const command = await startCommand({ ...input, model: "sonnet" }, { model: "opus" });
      expect(command).toContain(" --model sonnet ");
      expect(command).not.toContain("opus");
    });

    test("without the run's model, uses the runner configuration's model", async () => {
      expect(await startCommand(input, { model: "opus" })).toContain(" --model opus ");
    });

    test("without either, does not pass --model so the runner's Orca default applies", async () => {
      expect(await startCommand(input)).not.toContain("--model");
    });
  });

  test("a sender identity error means the mailbox is missing", async () => {
    const exec = withProjects(
      new ScriptedExec().orca(
        "orchestration worker-start",
        stdout(research("0008/run-create-no-from-error.json"), 1),
      ),
    );
    expect(await adapterError(runnerWith(exec).startRun(input))).toMatchObject({
      kind: "mailbox-missing",
    });
  });

  test("other ok: false is a runner error that left no run", async () => {
    const exec = withProjects(
      new ScriptedExec().orca(
        "orchestration worker-start",
        stdout(research("0008/worker-stop-from-error.json"), 1),
      ),
    );
    expect(await adapterError(runnerWith(exec).startRun(input))).toMatchObject({
      kind: "runner-error",
      code: "invalid_argument",
    });
  });

  test("losing the connection after sending the start is an unknown outcome", async () => {
    const exec = withProjects(
      new ScriptedExec().orca(
        "orchestration worker-start",
        processResult(own("ssh-unreachable.json")),
      ),
    );
    expect(await adapterError(runnerWith(exec).startRun(input))).toMatchObject({
      kind: "start-outcome-unknown",
    });
    const unknown = withProjects(
      new ScriptedExec().orca(
        "orchestration worker-start",
        stdout(
          JSON.stringify({ ok: true, result: { ...startResult(), state: "outcome_unknown" } }),
          1,
        ),
      ),
    );
    expect(await adapterError(runnerWith(unknown).startRun(input))).toMatchObject({
      kind: "start-outcome-unknown",
    });
  });

  test("an unknown state or broken output after sending is an unknown outcome; failed is not", async () => {
    const odd = withProjects(
      new ScriptedExec().orca(
        "orchestration worker-start",
        stdout(JSON.stringify({ ok: true, result: { ...startResult(), state: "setting_up" } }), 1),
      ),
    );
    expect(await adapterError(runnerWith(odd).startRun(input))).toMatchObject({
      kind: "start-outcome-unknown",
    });
    const failed = withProjects(
      new ScriptedExec().orca(
        "orchestration worker-start",
        stdout(JSON.stringify({ ok: true, result: { ...startResult(), state: "failed" } }), 1),
      ),
    );
    expect(await adapterError(runnerWith(failed).startRun(input))).toMatchObject({
      kind: "runner-error",
      code: "worker_start_failed",
    });
  });

  test("an unreachable runner before the start is sent stays unreachable", async () => {
    const exec = new ScriptedExec().orca(
      "project list",
      processResult(own("ssh-unreachable.json")),
    );
    expect(await adapterError(runnerWith(exec).startRun(input))).toMatchObject({
      kind: "unreachable",
    });
    expect(exec.commands().some((c) => c.includes("worker-start"))).toBe(false);
  });

  test("broken output after sending the start is an unknown outcome", async () => {
    const exec = withProjects(new ScriptedExec().orca("orchestration worker-start", BROKEN));
    expect(await adapterError(runnerWith(exec).startRun(input))).toMatchObject({
      kind: "start-outcome-unknown",
    });
  });

  test("an unknown project is a runner error", async () => {
    const exec = withProjects(new ScriptedExec());
    expect(
      await adapterError(
        runnerWith(exec).startRun({ ...input, project: toRunnerProjectId("github:acme/other") }),
      ),
    ).toMatchObject({ kind: "runner-error", code: "project_not_found" });
  });
});

function startResult(): Record<string, unknown> {
  const parsed: unknown = JSON.parse(own("worker-start-spec-stdin.json"));
  if (typeof parsed !== "object" || parsed === null || !("result" in parsed)) throw new Error();
  const result: unknown = parsed.result;
  if (typeof result !== "object" || result === null) throw new Error();
  return { ...result };
}

describe("findStartedRun", () => {
  test("finds the run started under the deterministic worktree name", async () => {
    const exec = new ScriptedExec()
      .orca("worktree show", stdout(own("worktree-show.json")))
      .orca("orchestration worker-list", stdout(own("worker-list-run.json")))
      .orca("orchestration worker-show", stdout(own("worker-show-working.json")));
    const found = await runnerWith(exec).findStartedRun({
      mailbox: MAILBOX,
      worktreeName: "fo-t0013-probe1",
    });
    expect(found).toEqual({
      worktree: WORKTREE,
      branch: "acme/fo-t0013-probe1",
      agentRef: RUN.agentRef,
    });
    expect(exec.commands().slice(0, 2)).toEqual([
      "/Applications/Orca.app/Contents/Resources/bin/orca worktree show --worktree name:fo-t0013-probe1 --json",
      "/Applications/Orca.app/Contents/Resources/bin/orca orchestration worker-list --run run_493ebb2f403d --limit 100 --json",
    ]);
  });

  test("looks through every Run and page when the mailbox Run does not have it", async () => {
    const empty = stdout(JSON.stringify({ ok: true, result: { workers: [] } }));
    const other = stdout(
      JSON.stringify({
        ok: true,
        result: {
          workers: [{ dispatchId: "ctx_other", taskId: "task_other", workspace: "x::/y" }],
          nextCursor: "p2",
        },
      }),
    );
    const exec = new ScriptedExec()
      .orca("worktree show", stdout(own("worktree-show.json")))
      .orca("orchestration worker-list --run", empty)
      .orca("orchestration worker-list --limit 100 --json", other)
      .orca(
        "orchestration worker-list --limit 100 --cursor p2",
        stdout(own("worker-list-run.json")),
      )
      .orca("orchestration worker-show", stdout(own("worker-show-working.json")));
    const found = await runnerWith(exec).findStartedRun({
      mailbox: MAILBOX,
      worktreeName: "fo-t0013-probe1",
    });
    expect(found?.agentRef).toBe(RUN.agentRef);
  });

  test("a named worktree without an agent is an error, not 'not started'", async () => {
    const exec = new ScriptedExec()
      .orca("worktree show", stdout(own("worktree-show.json")))
      .orca(
        "orchestration worker-list",
        stdout(JSON.stringify({ ok: true, result: { workers: [] } })),
      );
    expect(
      await adapterError(
        runnerWith(exec).findStartedRun({ mailbox: MAILBOX, worktreeName: "fo-t0013-probe1" }),
      ),
    ).toMatchObject({ kind: "runner-error", code: "worktree_without_agent" });
  });

  test("is null when no worktree has that name", async () => {
    const exec = new ScriptedExec().orca(
      "worktree show",
      stdout(own("worktree-show-not-found.json"), 1),
    );
    expect(
      await runnerWith(exec).findStartedRun({ mailbox: MAILBOX, worktreeName: "fo-no-such" }),
    ).toBeNull();
  });

  test("broken output is malformed", async () => {
    const exec = new ScriptedExec().orca("worktree show", BROKEN);
    expect(
      await adapterError(runnerWith(exec).findStartedRun({ mailbox: MAILBOX, worktreeName: "x" })),
    ).toMatchObject({ kind: "malformed-output" });
  });
});

describe("pollRun", () => {
  function polling(worker: string, peek: string): ScriptedExec {
    return new ScriptedExec()
      .orca("orchestration worker-show", stdout(worker))
      .orca("orchestration check", stdout(peek))
      .orca("worktree ps", stdout(own("worktree-ps-agent-wait-working.json")));
  }

  test("a working agent without mail is active", async () => {
    const exec = polling(own("worker-show-working.json"), own("check-peek-empty.json"));
    expect(await runnerWith(exec).pollRun(RUN)).toEqual({
      kind: "active",
      questions: [],
      permissionWaits: [],
    });
    expect(exec.commands()).toContain(
      "/Applications/Orca.app/Contents/Resources/bin/orca orchestration check --terminal term_41ac5f6b-daad-43f3-9264-9e25ddd24ef7 --peek --full --json",
    );
    expect(exec.commands()).toContain(
      "/Applications/Orca.app/Contents/Resources/bin/orca worktree ps --agent-wait --limit 500 --json",
    );
    expect(exec.commands().some((c) => c.includes("task-list"))).toBe(false);
    expectNoConsumingCheck(exec);
  });

  test("an asked question comes back with its options and time, without consuming mail", async () => {
    const exec = polling(own("worker-show-working.json"), own("check-peek-full-question.json"));
    expect(await runnerWith(exec).pollRun(RUN)).toEqual({
      kind: "active",
      questions: [
        {
          id: toQuestionId("msg_49acb8390fb2"),
          body: `Pick one: A or B? (quotes ' " and $HOME stay literal)`,
          options: [],
          askedAt: new Date("2026-11-17T16:07:58Z"),
        },
      ],
      permissionWaits: [],
    });
    expectNoConsumingCheck(exec);
  });

  test("a completion report comes from the Task result", async () => {
    const exec = new ScriptedExec()
      .orca("orchestration worker-show", stdout(own("worker-show-failed-report.json")))
      .orca("orchestration task-list", stdout(own("task-list-full-brief-failed-report.json")));
    const progress = await runnerWith(exec).pollRun(RUN);
    expect(progress).toMatchObject({
      kind: "reported",
      report: { outcome: "failed", reportedAt: new Date("2026-11-17T16:08:28.349Z") },
    });
    expect(progress.kind === "reported" && progress.report.body).toContain(
      "The exact answer text received was",
    );
    expect(exec.commands()).toContain(
      "/Applications/Orca.app/Contents/Resources/bin/orca orchestration task-list --run run_493ebb2f403d --full --brief --json",
    );
  });

  test("a removed worktree is worktree-gone", async () => {
    const exec = new ScriptedExec()
      .orca("orchestration worker-show", stdout(own("worker-show-working.json")))
      .orca("orchestration check", stdout(own("check-peek-empty.json")))
      .orca(
        "worktree ps",
        stdout(JSON.stringify({ ok: true, result: { worktrees: [], totalCount: 0 } })),
      )
      .orca("worktree show", stdout(own("worktree-show-not-found.json"), 1));
    expect(await runnerWith(exec).pollRun(RUN)).toEqual({ kind: "worktree-gone" });
  });

  test("reads the research 0008 lost escalation as ended without report", async () => {
    const r3: RunOnRunner = {
      mailbox: encodeMailbox({
        terminal: "term_00000000-0000-4000-8000-000000000001",
        runId: "run_000000000001",
      }),
      worktree: toWorktreeRef(
        "10000000-0000-4000-8000-000000000004::<path>/workspaces/sandbox/fo-orch-r3",
      ),
      agentRef: encodeAgent({
        dispatchId: "ctx_000000000003",
        taskId: "task_000000000003",
        runId: "run_000000000001",
      }),
    };
    const exec = new ScriptedExec()
      .orca("orchestration worker-show", stdout(research("0008/worker-show-lost.json")))
      .orca("orchestration task-list", stdout(research("0008/task-list-after-lost.json")))
      .orca("orchestration check", stdout(peekOf(research("0008/escalation-lost-full.json"))))
      .orca("worktree ps", stdout(JSON.stringify({ ok: true, result: { worktrees: [] } })))
      .orca("worktree show", stdout(own("worktree-show-not-found.json"), 1));
    expect(await runnerWith(exec).pollRun(r3)).toEqual({
      kind: "ended-without-report",
      detail: "lost: Worker lost without reporting",
    });
    expectNoConsumingCheck(exec);
  });

  test("ok: false and broken output become error kinds", async () => {
    const failing = new ScriptedExec().orca(
      "orchestration worker-show",
      stdout(JSON.stringify({ ok: false, error: { code: "dispatch_not_found", message: "x" } }), 1),
    );
    expect(await adapterError(runnerWith(failing).pollRun(RUN))).toMatchObject({
      kind: "runner-error",
      code: "dispatch_not_found",
    });
    const broken = polling(own("worker-show-working.json"), "{not json");
    expect(await adapterError(runnerWith(broken).pollRun(RUN))).toMatchObject({
      kind: "malformed-output",
    });
  });

  test("a mailbox that lost its Run binding is reported as missing", async () => {
    const exec = polling(own("worker-show-working.json"), own("check-peek-consumer-fenced.json"));
    expect(await adapterError(runnerWith(exec).pollRun(RUN))).toMatchObject({
      kind: "mailbox-missing",
    });
  });

  test("reads the Run inbox when the run started under another Run", async () => {
    const exec = new ScriptedExec()
      .orca("orchestration worker-show", stdout(own("worker-show-working.json")))
      .orca("orchestration inbox", stdout(own("check-peek-full-question.json")))
      .orca("worktree ps", stdout(own("worktree-ps-agent-wait-working.json")));
    const moved = { ...RUN, mailbox: encodeMailbox({ terminal: "term_new", runId: "run_new" }) };
    const progress = await runnerWith(exec).pollRun(moved);
    expect(progress.kind === "active" && progress.questions.map((q) => q.id)).toEqual([
      "msg_49acb8390fb2",
    ]);
    expect(exec.commands()).toContain(
      "/Applications/Orca.app/Contents/Resources/bin/orca orchestration inbox --terminal run:run_493ebb2f403d --limit 500 --full --json",
    );
    expectNoConsumingCheck(exec);
  });
});

describe("answerQuestion and denyPermission", () => {
  test("sends an answer with newlines, quotes and $ as one quoted argument", async () => {
    const exec = new ScriptedExec().orca("orchestration reply", stdout(own("reply.json")));
    await runnerWith(exec).answerQuestion(RUN, {
      questionId: toQuestionId("msg_49acb8390fb2"),
      answer: `A\nsecond line: it's "quoted" $HOME \`echo x\``,
    });
    expect(exec.commands()).toEqual([
      `/Applications/Orca.app/Contents/Resources/bin/orca orchestration reply --from term_41ac5f6b-daad-43f3-9264-9e25ddd24ef7 --id msg_49acb8390fb2 --body 'A\nsecond line: it'\\''s "quoted" $HOME \`echo x\`' --json`,
    ]);
  });

  test("a second, different answer is a runner error; broken output is malformed", async () => {
    const conflict = new ScriptedExec().orca(
      "orchestration reply",
      stdout(own("reply-answer-conflict.json"), 1),
    );
    const input = { questionId: toQuestionId("msg_49acb8390fb2"), answer: "x" };
    expect(await adapterError(runnerWith(conflict).answerQuestion(RUN, input))).toMatchObject({
      kind: "runner-error",
      code: "answer_conflict",
    });
    const broken = new ScriptedExec().orca("orchestration reply", BROKEN);
    expect(await adapterError(runnerWith(broken).answerQuestion(RUN, input))).toMatchObject({
      kind: "malformed-output",
    });
  });

  test("an answer over the ssh limit is refused before anything is sent", async () => {
    const exec = new ScriptedExec();
    expect(
      await adapterError(
        runnerWith(exec).answerQuestion(RUN, {
          questionId: toQuestionId("msg_1"),
          answer: "x".repeat(210 * 1024),
        }),
      ),
    ).toMatchObject({ kind: "runner-error", code: "argument_too_long" });
    expect(exec.calls).toHaveLength(0);
  });

  test("ok: false and broken output from deny become error kinds", async () => {
    const input = { permissionId: toPermissionRequestId("apr_1"), reason: "no" };
    const off = new ScriptedExec().orca(
      "orchestration deny",
      stdout(research("0003/worktree-ps-runtime-off.json"), 1),
    );
    expect(await adapterError(runnerWith(off).denyPermission(RUN, input))).toMatchObject({
      kind: "not-ready",
    });
    const broken = new ScriptedExec().orca("orchestration deny", BROKEN);
    expect(await adapterError(runnerWith(broken).denyPermission(RUN, input))).toMatchObject({
      kind: "malformed-output",
    });
  });

  test("denies a permission prompt with a reason", async () => {
    const exec = new ScriptedExec().orca("orchestration deny", stdout(research("0008/deny.json")));
    await runnerWith(exec).denyPermission(RUN, {
      permissionId: toPermissionRequestId("apr_0000000000000001"),
      reason: "Don't touch files; skip it.",
    });
    expect(exec.commands()).toEqual([
      "/Applications/Orca.app/Contents/Resources/bin/orca orchestration deny --from term_41ac5f6b-daad-43f3-9264-9e25ddd24ef7 --dispatch ctx_a6e6a23a7132 --prompt apr_0000000000000001 --reason 'Don'\\''t touch files; skip it.' --json",
    ]);
  });
});

describe("stopAgent, closeAgent and readLogTail", () => {
  test("stops with worker-stop and releases with worker-release", async () => {
    const exec = new ScriptedExec()
      .orca("orchestration worker-stop", stdout(research("0008/worker-stop.json")))
      .orca("orchestration worker-release", stdout(own("worker-release.json")));
    const runner = runnerWith(exec);
    await runner.stopAgent(RUN);
    await runner.closeAgent(RUN);
    expect(exec.commands()).toEqual([
      "/Applications/Orca.app/Contents/Resources/bin/orca orchestration worker-stop --dispatch ctx_a6e6a23a7132 --json",
      "/Applications/Orca.app/Contents/Resources/bin/orca orchestration worker-release --dispatch ctx_a6e6a23a7132 --json",
    ]);
  });

  test("ok: false and broken output from stop become error kinds", async () => {
    const failing = new ScriptedExec().orca(
      "orchestration worker-stop",
      stdout(research("0008/worker-stop-from-error.json"), 1),
    );
    expect(await adapterError(runnerWith(failing).stopAgent(RUN))).toMatchObject({
      kind: "runner-error",
    });
    const broken = new ScriptedExec().orca("orchestration worker-release", BROKEN);
    expect(await adapterError(runnerWith(broken).closeAgent(RUN))).toMatchObject({
      kind: "malformed-output",
    });
  });

  test("ok: false from release and log reads become error kinds", async () => {
    const release = new ScriptedExec().orca(
      "orchestration worker-release",
      stdout(JSON.stringify({ ok: false, error: { code: "release_unknown", message: "x" } }), 1),
    );
    expect(await adapterError(runnerWith(release).closeAgent(RUN))).toMatchObject({
      kind: "runner-error",
      code: "release_unknown",
    });
    const read = new ScriptedExec().orca(
      "orchestration worker-read",
      stdout(own("worker-read-terminal-released-error.json"), 1),
    );
    expect(await adapterError(runnerWith(read).readLogTail(RUN, { lines: 5 }))).toMatchObject({
      kind: "runner-error",
      code: "runtime_error",
    });
  });

  test("returns the last lines of the agent transcript", async () => {
    const exec = new ScriptedExec().orca(
      "orchestration worker-read",
      stdout(own("worker-read-transcript.json")),
    );
    const lines = await runnerWith(exec).readLogTail(RUN, { lines: 3 });
    expect(lines).toHaveLength(3);
    expect(lines.at(-1)).toBe("I made no edits, commits, or pushes.");
    expect(exec.commands()).toEqual([
      "/Applications/Orca.app/Contents/Resources/bin/orca orchestration worker-read --dispatch ctx_a6e6a23a7132 --limit 100 --json",
    ]);
  });

  test("reads every page to reach the end of a long transcript", async () => {
    const page = (from: number, count: number, next: string | null) =>
      stdout(
        JSON.stringify({
          ok: true,
          result: {
            source: "transcript",
            transcript: {
              messages: Array.from({ length: count }, (_, i) => ({
                role: "assistant",
                blocks: [{ type: "text", text: `line ${from + i}` }],
              })),
              nextCursor: next,
            },
          },
        }),
      );
    const exec = new ScriptedExec()
      .orca(
        "orchestration worker-read --dispatch ctx_a6e6a23a7132 --limit 100 --json",
        page(0, 100, "c1"),
      )
      .orca(
        "orchestration worker-read --dispatch ctx_a6e6a23a7132 --limit 100 --cursor c1",
        page(100, 30, "c2"),
      );
    const lines = await runnerWith(exec).readLogTail(RUN, { lines: 2 });
    expect(lines).toEqual(["[assistant] line 128", "[assistant] line 129"]);
    expect(exec.calls).toHaveLength(2);
  });

  test("marks the tail as cut when the transcript is longer than the page limit", async () => {
    let n = 0;
    const exec = new ScriptedExec().orca("orchestration worker-read", () => {
      n += 1;
      return stdout(
        JSON.stringify({
          ok: true,
          result: {
            source: "transcript",
            transcript: {
              messages: Array.from({ length: 100 }, (_, i) => ({
                role: "assistant",
                blocks: [{ type: "text", text: `page ${n} line ${i}` }],
              })),
              nextCursor: `c${n}`,
            },
          },
        }),
      );
    });
    const lines = await runnerWith(exec).readLogTail(RUN, { lines: 3 });
    expect(exec.calls).toHaveLength(LOG_MAX_PAGES);
    expect(lines).toEqual([
      LOG_CUT_MARKER,
      `[assistant] page ${LOG_MAX_PAGES} line 98`,
      `[assistant] page ${LOG_MAX_PAGES} line 99`,
    ]);
  });

  test("an archived empty terminal gives no lines; broken output is malformed", async () => {
    const empty = new ScriptedExec().orca(
      "orchestration worker-read",
      stdout(own("worker-read-terminal-empty.json")),
    );
    expect(await runnerWith(empty).readLogTail(RUN, { lines: 200 })).toEqual([]);
    const broken = new ScriptedExec().orca("orchestration worker-read", BROKEN);
    expect(await adapterError(runnerWith(broken).readLogTail(RUN, { lines: 5 }))).toMatchObject({
      kind: "malformed-output",
    });
  });
});

describe("worktreeExists and removeWorktree", () => {
  test("answers whether the worktree is still on the runner", async () => {
    const there = new ScriptedExec().orca("worktree show", stdout(own("worktree-show.json")));
    expect(await runnerWith(there).worktreeExists(WORKTREE)).toBe(true);
    const gone = new ScriptedExec().orca(
      "worktree show",
      stdout(own("worktree-show-not-found.json"), 1),
    );
    expect(await runnerWith(gone).worktreeExists(WORKTREE)).toBe(false);
    const broken = new ScriptedExec().orca("worktree show", BROKEN);
    expect(await adapterError(runnerWith(broken).worktreeExists(WORKTREE))).toMatchObject({
      kind: "malformed-output",
    });
  });

  test("removes with --force and keeps the branch", async () => {
    const exec = new ScriptedExec().orca("worktree rm", stdout(own("worktree-rm-force.json")));
    await runnerWith(exec).removeWorktree(WORKTREE);
    expect(exec.commands()).toEqual([
      `/Applications/Orca.app/Contents/Resources/bin/orca worktree rm --worktree 'id:${WORKTREE}' --force --json`,
    ]);
  });

  test("a worktree already gone is fine; a stopped runtime is not ready", async () => {
    const gone = new ScriptedExec().orca(
      "worktree rm",
      stdout(own("worktree-show-not-found.json"), 1),
    );
    await expect(runnerWith(gone).removeWorktree(WORKTREE)).resolves.toBeUndefined();
    const off = new ScriptedExec().orca(
      "worktree rm",
      stdout(research("0003/worktree-rm-runtime-off.json"), 1),
    );
    expect(await adapterError(runnerWith(off).removeWorktree(WORKTREE))).toMatchObject({
      kind: "not-ready",
    });
  });
});

describe("pauseAgent and resumeAgent", () => {
  const ORCA = "/Applications/Orca.app/Contents/Resources/bin/orca";
  const AGENT_TERMINAL = "term_9c1d6b7e-2f0a-4c55-9a3e-0d5f1e2b7a10";
  const shown = (fields: Record<string, string | null>) =>
    stdout(
      JSON.stringify({
        ok: true,
        result: {
          dispatchId: "ctx_a6e6a23a7132",
          taskId: "task_43a3a070dc4c",
          runId: "run_493ebb2f403d",
          state: "ready",
          ...fields,
        },
      }),
    );
  const sent = stdout(JSON.stringify({ ok: true, result: { send: { accepted: true } } }));
  const resumeInput = {
    agent: toAgentId("claude"),
    message: "Continue where you stopped.",
    restartPrompt: "ACME-1 Fix checkout\n\nPick up where the previous agent stopped.",
  };

  test("pauses by sending Escape to the live agent terminal, without stopping the worker", async () => {
    const exec = new ScriptedExec()
      .orca("orchestration worker-show", shown({ liveness: "live", terminal: AGENT_TERMINAL }))
      .orca("terminal send", sent);
    await runnerWith(exec).pauseAgent(RUN);
    expect(exec.commands()).toEqual([
      `${ORCA} orchestration worker-show --dispatch ctx_a6e6a23a7132 --json`,
      `${ORCA} terminal send --terminal ${AGENT_TERMINAL} --text '\u001b' --json`,
    ]);
    expect(exec.commands().some((command) => command.includes("worker-stop"))).toBe(false);
  });

  test("pausing an agent that already exited is a runner error and sends nothing", async () => {
    const exec = new ScriptedExec().orca(
      "orchestration worker-show",
      shown({ liveness: "exited", terminal: AGENT_TERMINAL }),
    );
    expect(await adapterError(runnerWith(exec).pauseAgent(RUN))).toMatchObject({
      kind: "runner-error",
      code: "agent_not_running",
    });
    expect(exec.commands()).toHaveLength(1);
  });

  test("an unverifiable agent is paused only when its terminal is still connected", async () => {
    const exec = new ScriptedExec()
      .orca(
        "orchestration worker-show",
        shown({ liveness: "unverifiable", terminal: AGENT_TERMINAL }),
      )
      .orca(
        "terminal show",
        stdout(
          JSON.stringify({
            ok: true,
            result: { terminal: { handle: AGENT_TERMINAL, connected: true } },
          }),
        ),
      )
      .orca("terminal send", sent);
    await runnerWith(exec).pauseAgent(RUN);
    expect(exec.commands()[2]).toContain("terminal send");
  });

  test("a terminal that refuses input is a runner error", async () => {
    const exec = new ScriptedExec()
      .orca("orchestration worker-show", shown({ liveness: "live", terminal: AGENT_TERMINAL }))
      .orca(
        "terminal send",
        stdout(JSON.stringify({ ok: true, result: { send: { accepted: false } } })),
      );
    expect(await adapterError(runnerWith(exec).pauseAgent(RUN))).toMatchObject({
      kind: "runner-error",
      code: "input_not_accepted",
    });
  });

  test("resumes the same conversation by typing the message into the agent terminal", async () => {
    const exec = new ScriptedExec()
      .orca("orchestration worker-show", shown({ liveness: "live", terminal: AGENT_TERMINAL }))
      .orca("terminal send", sent);
    const resumed = await runnerWith(exec).resumeAgent(RUN, resumeInput);
    expect(resumed).toEqual({ agentRef: RUN.agentRef, restarted: false });
    expect(exec.commands()).toEqual([
      `${ORCA} orchestration worker-show --dispatch ctx_a6e6a23a7132 --json`,
      `${ORCA} terminal send --terminal ${AGENT_TERMINAL} --text 'Continue where you stopped.' --enter --json`,
    ]);
  });

  const onlyOldWorker = stdout(
    JSON.stringify({
      ok: true,
      result: {
        workers: [
          { dispatchId: "ctx_a6e6a23a7132", taskId: "task_43a3a070dc4c", workspace: WORKTREE },
        ],
        nextCursor: null,
      },
    }),
  );

  test("starts a new agent in the same worktree when the conversation is gone", async () => {
    const exec = new ScriptedExec()
      .orca("orchestration worker-show", shown({ liveness: "exited", terminal: null }))
      .orca("orchestration worker-list", onlyOldWorker)
      .orca(
        "orchestration worker-start",
        stdout(
          JSON.stringify({
            ok: true,
            result: {
              dispatchId: "ctx_new",
              taskId: "task_new",
              runId: "run_493ebb2f403d",
              state: "ready",
            },
          }),
        ),
      );
    const resumed = await runnerWith(exec).resumeAgent(RUN, resumeInput);
    expect(resumed.restarted).toBe(true);
    expect(decodeAgent(resumed.agentRef)).toEqual({
      dispatchId: "ctx_new",
      taskId: "task_new",
      runId: "run_493ebb2f403d",
    });
    expect(exec.commands()[2]).toBe(
      `${ORCA} orchestration worker-start --from term_41ac5f6b-daad-43f3-9264-9e25ddd24ef7 --run run_493ebb2f403d --spec-file - --task-title 'resume task_43a3a070dc4c' --worktree 'id:${WORKTREE}' --agent claude --json`,
    );
    expect(exec.calls[2]?.stdin).toBe(resumeInput.restartPrompt);
    expect(exec.commands().some((command) => command.includes("--name"))).toBe(false);
  });

  test("a restart that ends failed is a runner error", async () => {
    const exec = new ScriptedExec()
      .orca("orchestration worker-show", shown({ liveness: "exited", terminal: null }))
      .orca("orchestration worker-list", onlyOldWorker)
      .orca(
        "orchestration worker-start",
        stdout(
          JSON.stringify({
            ok: true,
            result: { dispatchId: "ctx_new", taskId: "task_new", runId: "run_1", state: "failed" },
          }),
        ),
      );
    expect(await adapterError(runnerWith(exec).resumeAgent(RUN, resumeInput))).toMatchObject({
      kind: "runner-error",
      code: "worker_start_failed",
    });
  });

  test("a restart whose outcome is unknown is reported as such, and a retry adopts the started agent", async () => {
    const lost = new ScriptedExec()
      .orca("orchestration worker-show", shown({ liveness: "exited", terminal: null }))
      .orca("orchestration worker-list", onlyOldWorker)
      .orca("orchestration worker-start", stdout("ssh: connection reset", 255));
    expect(await adapterError(runnerWith(lost).resumeAgent(RUN, resumeInput))).toMatchObject({
      kind: "start-outcome-unknown",
    });

    const retry = new ScriptedExec()
      .orca(
        "orchestration worker-show --dispatch ctx_a6e6a23a7132",
        shown({ liveness: "exited", terminal: null }),
      )
      .orca(
        "orchestration worker-list",
        stdout(
          JSON.stringify({
            ok: true,
            result: {
              workers: [
                {
                  dispatchId: "ctx_a6e6a23a7132",
                  taskId: "task_43a3a070dc4c",
                  workspace: WORKTREE,
                },
                { dispatchId: "ctx_new", taskId: "task_new", workspace: WORKTREE },
              ],
              nextCursor: null,
            },
          }),
        ),
      )
      .orca(
        "orchestration worker-show --dispatch ctx_new",
        shown({ liveness: "live", terminal: AGENT_TERMINAL }),
      );
    const resumed = await runnerWith(retry).resumeAgent(RUN, resumeInput);
    expect(resumed.restarted).toBe(true);
    expect(decodeAgent(resumed.agentRef)?.dispatchId).toBe("ctx_new");
    expect(retry.commands().some((command) => command.includes("worker-start"))).toBe(false);
  });

  test("with startIfGone false a resume only adopts and never starts a new agent", async () => {
    const exec = new ScriptedExec()
      .orca("orchestration worker-show", shown({ liveness: "exited", terminal: null }))
      .orca("orchestration worker-list", onlyOldWorker);
    expect(
      await adapterError(runnerWith(exec).resumeAgent(RUN, { ...resumeInput, startIfGone: false })),
    ).toMatchObject({ kind: "runner-error", code: "agent_not_running" });
    expect(exec.commands().some((command) => command.includes("worker-start"))).toBe(false);
  });
});
