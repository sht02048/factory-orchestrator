import { toAgentId, toQuestionId, toRunnerProjectId } from "@factory/core";
import type { MailboxRef, RunOnRunner, RunProgress, StartedRun } from "@factory/core";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { DEFAULT_ORCA_PATH, parseOrcaRunnerConfig } from "./config.js";
import { OrcaRunner } from "./orca-runner.js";
import { decodeMailbox, encodeMailbox } from "./refs.js";
import { toRemoteCommand } from "./shell.js";
import { sshExec } from "./ssh.js";

/**
 * 실제 러너에 붙는 선택 실행 통합 테스트. 기본 CI에서는 건너뛰고 환경 변수로 켠다. 에이전트를 한 번 띄우므로
 * 가벼운 모델과 버려도 되는 저장소(sandbox)에서만 돌린다. 끝나면 에이전트·워크트리·로컬 브랜치·우편함
 * 터미널을 지운다. 오케스트레이션 Run 기록은 지울 명령이 없어(research 0008 7절) `RUNNER_ORCA_IT_RUN`으로
 * 같은 Run을 이어 쓰게 할 수 있다.
 *
 * ```sh
 * RUNNER_ORCA_IT_SSH_TARGET=<ssh host> RUNNER_ORCA_IT_PROJECT=github:<owner>/<sandbox> \
 *   [RUNNER_ORCA_IT_RUN=run_…] [RUNNER_ORCA_IT_MODEL=haiku] [RUNNER_ORCA_IT_ORCA_PATH=…] \
 *   pnpm vitest run --project runner-orca src/runner.integration.test.ts
 * ```
 */
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
        prompt: PROMPT,
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
      // 답이 원격 셸을 거쳐도 그대로 갔는지. 에이전트가 옮겨 적으므로 특수 문자가 든 부분만 본다.
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

/** 실패해도 남는 것이 없게 한다. 각 단계의 실패는 무시하고 다음으로 간다. */
async function cleanUp(
  runner: OrcaRunner,
  exec: ReturnType<typeof sshExec>,
  mailbox: MailboxRef | null,
  startedRun: StartedRun | null,
  worktreeName: string,
): Promise<void> {
  const ignore = (): undefined => undefined;
  // startRun이 시작 명령을 보낸 뒤 던졌으면(결과 모름 등) 에이전트가 떠 있을 수 있어 이름으로 다시 찾는다.
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
