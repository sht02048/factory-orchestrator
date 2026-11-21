import { toAgentId, toQuestionId, toRunnerProjectId } from "@ganger/core";
import type { MailboxRef, RunOnRunner, RunProgress, StartedRun } from "@ganger/core";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { DEFAULT_ORCA_PATH, parseOrcaRunnerConfig } from "./config.js";
import { OrcaRunner } from "./orca-runner.js";
import { decodeMailbox, encodeMailbox } from "./refs.js";
import { toRemoteCommand } from "./shell.js";
import { sshExec } from "./ssh.js";

const target = process.env["RUNNER_ORCA_IT_SSH_TARGET"];
const project = process.env["RUNNER_ORCA_IT_PROJECT"];
const reuseRun = process.env["RUNNER_ORCA_IT_RUN"];
const model = process.env["RUNNER_ORCA_IT_MODEL"] ?? "haiku";
const orcaPath = process.env["RUNNER_ORCA_IT_ORCA_PATH"] ?? DEFAULT_ORCA_PATH;
const enabled = target !== undefined && project !== undefined;

const ANSWER = `A\nkeep it literal: it's "quoted" $HOME \`echo x\``;
const PROMPT = `Disposable adapter integration test. Do not edit, commit, or push anything.

1. Ask your coordinator exactly this, with options "A,B", using the orca orchestration ask command from your preamble:
   Pick A or B?
   Then end your turn and wait for the answer.
2. When the answer arrives, finish with worker_done, outcome succeeded, subject "integration done", and put the exact answer text you received in the body.
Do nothing else.`;

describe.skipIf(!enabled)("orca runner on a real runner", () => {
  test("runs one run end to end and cleans up", { timeout: 15 * 60_000 }, async () => {
    if (target === undefined || project === undefined) return;
    const runner = new OrcaRunner(parseOrcaRunnerConfig({ sshTarget: target, orcaPath, model }));
    const exec = sshExec({ sshTarget: target, connectTimeoutSeconds: 10 });
    const worktreeName = `fo-it-${Date.now()}`;
    let mailbox: MailboxRef | null = null;
    let started: StartedRun | null = null;

    try {
      const health = await runner.checkHealth();
      expect(health.online).toBe(true);
      expect(health.prerequisites.find((p) => p.id === `github-push:${project}`)?.satisfied).toBe(
        true,
      );
      const projects = await runner.listProjects();
      expect(projects.map((p) => p.id)).toContain(project);

      mailbox = await runner.ensureMailbox(
        reuseRun === undefined ? null : encodeMailbox({ terminal: "term_none", runId: reuseRun }),
      );
      expect(await runner.ensureMailbox(mailbox)).toBe(mailbox);

      started = await runner.startRun({
        mailbox,
        project: toRunnerProjectId(project),
        worktreeName,
        agent: toAgentId("claude"),
        brief: PROMPT,
      });
      expect(started.branch.endsWith(worktreeName)).toBe(true);
      expect(await runner.findStartedRun({ mailbox, worktreeName })).toEqual(started);

      const run: RunOnRunner = { mailbox, worktree: started.worktree, agentRef: started.agentRef };
      const asked = await pollUntil(
        runner,
        run,
        (p) => p.kind !== "active" || p.questions.length > 0,
      );
      expect(asked.kind).toBe("active");
      const question = asked.kind === "active" ? asked.questions[0] : undefined;
      expect(question).toBeDefined();
      await runner.answerQuestion(run, {
        questionId: question?.id ?? toQuestionId("missing"),
        answer: ANSWER,
      });

      const reported = await pollUntil(runner, run, (p) => p.kind !== "active");
      expect(reported).toMatchObject({ kind: "reported", report: { outcome: "succeeded" } });
      expect(reported.kind === "reported" ? reported.report.body : "").toContain("$HOME");

      expect((await runner.readLogTail(run, { lines: 50 })).length).toBeGreaterThan(0);
      await runner.closeAgent(run);
      await runner.removeWorktree(started.worktree);
      expect(await runner.worktreeExists(started.worktree)).toBe(false);
    } finally {
      await cleanUp(runner, exec, mailbox, started, worktreeName);
    }
  });
});

async function pollUntil(
  runner: OrcaRunner,
  run: RunOnRunner,
  done: (progress: RunProgress) => boolean,
): Promise<RunProgress> {
  const deadline = Date.now() + 5 * 60_000;
  for (;;) {
    const progress = await runner.pollRun(run);
    if (done(progress) || Date.now() > deadline) return progress;
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

const setupsSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    setups: z.array(z.object({ projectId: z.string(), hostId: z.string(), path: z.string() })),
  }),
});

async function cleanUp(
  runner: OrcaRunner,
  exec: ReturnType<typeof sshExec>,
  mailbox: MailboxRef | null,
  startedRun: StartedRun | null,
  worktreeName: string,
): Promise<void> {
  const ignore = (): undefined => undefined;
  const started =
    startedRun ??
    (mailbox === null
      ? null
      : await runner.findStartedRun({ mailbox, worktreeName }).catch(ignore)) ??
    null;
  if (started !== null && mailbox !== null) {
    const run = { mailbox, worktree: started.worktree, agentRef: started.agentRef };
    await runner.stopAgent(run).catch(ignore);
    await runner.closeAgent(run).catch(ignore);
    await runner.removeWorktree(started.worktree).catch(ignore);
    const setups = await exec
      .run(toRemoteCommand([orcaPath, "project", "setups", "--json"]), { timeoutMs: 60_000 })
      .catch(ignore);
    const parsed = setupsSchema.safeParse(parseJson(setups?.stdout ?? ""));
    const path = parsed.success
      ? parsed.data.result.setups.find((s) => s.projectId === project && s.hostId === "local")?.path
      : undefined;
    if (path !== undefined) {
      await exec
        .run(toRemoteCommand(["git", "-C", path, "branch", "-D", started.branch]), {
          timeoutMs: 60_000,
        })
        .catch(ignore);
    }
  }
  const terminal = mailbox === null ? null : decodeMailbox(mailbox)?.terminal;
  if (terminal !== null && terminal !== undefined) {
    await exec
      .run(toRemoteCommand([orcaPath, "terminal", "close", "--terminal", terminal, "--json"]), {
        timeoutMs: 60_000,
      })
      .catch(ignore);
  }
}

function parseJson(value: string): unknown {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    return null;
  }
}
