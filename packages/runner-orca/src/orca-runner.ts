import { AdapterError, toRunnerKind, toRunnerProjectId, toWorktreeRef } from "@ganger/core";
import type {
  MailboxRef,
  PermissionRequestId,
  ProviderUsageReading,
  QuestionId,
  Runner,
  RunnerErrorDetail,
  RunnerFactory,
  RunnerHealth,
  RunnerKind,
  RunnerPrerequisite,
  RunnerProject,
  RunOnRunner,
  RunProgress,
  StartedRun,
  StartRunInput,
  WorktreeRef,
} from "@ganger/core";
import { z } from "zod";
import { briefFor } from "./agent-brief.js";
import { parseOrcaRunnerConfig } from "./config.js";
import type { OrcaRunnerConfig } from "./config.js";
import { workerReadLines } from "./log-tail.js";
import { completionReport, decideProgress } from "./progress.js";
import { parseProviderUsage } from "./provider-usage.js";
import {
  PUSH_CHECK_CONCURRENCY,
  PUSH_CHECK_TIMEOUT_MS,
  PUSH_RETRY_DELAY_MS,
  choosePushRemote,
  classifyPush,
  mapWithConcurrency,
  pushArgv,
  remoteConfigArgv,
  unknownPush,
} from "./push-check.js";
import type { PushCheckOutcome } from "./push-check.js";
import { decodeAgent, decodeMailbox, encodeAgent, encodeMailbox } from "./refs.js";
import type { OrcaAgent, OrcaMailbox } from "./refs.js";
import {
  checkResultSchema,
  denyResultSchema,
  envelopeSchema,
  projectListResultSchema,
  projectSetupsResultSchema,
  replyResultSchema,
  runBindResultSchema,
  runCurrentResultSchema,
  serviceStatusResultSchema,
  statusResultSchema,
  taskListResultSchema,
  terminalCreateResultSchema,
  terminalShowResultSchema,
  workerListResultSchema,
  workerReadResultSchema,
  workerReleaseResultSchema,
  workerShowResultSchema,
  workerStartResultSchema,
  workerStopResultSchema,
  worktreePsResultSchema,
  worktreeRmResultSchema,
  worktreeShowResultSchema,
} from "./schemas.js";
import type { MailRow } from "./schemas.js";
import { serviceInstallArgs } from "./service-install.js";
import { RemoteCommandTooLongError, toRemoteCommand } from "./shell.js";
import { sshExec } from "./ssh.js";
import type { RemoteExec, RemoteResult } from "./ssh.js";

export const ORCA_RUNNER_KIND: RunnerKind = toRunnerKind("orca");

export const MAILBOX_TITLE = "ganger-mailbox";
const MAILBOX_COMMAND = "cat > /dev/null";
const RUN_OBJECTIVE = "ganger";
const WORKTREE_PS_LIMIT = 500;
const LOG_PAGE_SIZE = 100;
const WORKER_LIST_MAX_PAGES = 50;
export const LOG_MAX_PAGES = 200;
export const LOG_CUT_MARKER = `[log tail cut: the transcript is longer than ${LOG_PAGE_SIZE * LOG_MAX_PAGES} messages, so these are not its last lines]`;
const RAW_LIMIT = 4000;

const SENDER_ERROR_CODES = new Set([
  "no_active_sender_terminal",
  "terminal_handle_stale",
  "consumer_fenced",
]);

type Outcome<T> = { ok: true; result: T } | { ok: false; code: string; message: string };

interface CallOptions {
  stdin?: string;
  timeoutMs?: number;
  usesMailbox?: boolean;
}

interface ProjectRow {
  id: string;
  displayName: string;
  remoteName: string;
  setup: { repoId: string; path: string; setupState: string } | null;
}

export interface OrcaRunnerOptions {
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class OrcaRunner implements Runner {
  readonly kind = ORCA_RUNNER_KIND;
  private readonly config: OrcaRunnerConfig;
  private readonly exec: RemoteExec;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(config: OrcaRunnerConfig, exec?: RemoteExec, options: OrcaRunnerOptions = {}) {
    this.config = config;
    this.exec = exec ?? sshExec(config);
    this.sleep = options.sleep ?? realSleep;
  }

  async checkHealth(): Promise<RunnerHealth> {
    const checkedAt = new Date();
    let status: z.infer<typeof statusResultSchema>;
    try {
      status = await this.orca(["status"], statusResultSchema);
    } catch (error) {
      return { online: false, version: null, prerequisites: [], checkedAt, error: detailOf(error) };
    }
    const runtime = status.runtime;
    const online = runtime?.reachable === true && runtime.state === "ready";
    const version = runtime?.appVersion ?? null;
    const prerequisites: RunnerPrerequisite[] = [await this.servicePrerequisite()];
    if (!online) {
      return {
        online,
        version,
        prerequisites,
        checkedAt,
        error: { kind: "not-ready", detail: `runtime state: ${runtime?.state ?? "unknown"}` },
      };
    }
    try {
      const projects = await this.loadProjects();
      const pushes = await mapWithConcurrency(projects, PUSH_CHECK_CONCURRENCY, (project) =>
        this.pushPrerequisite(project),
      );
      prerequisites.push(...pushes);
    } catch (error) {
      return { online, version, prerequisites, checkedAt, error: detailOf(error) };
    }
    return { online, version, prerequisites, checkedAt, error: null };
  }

  async listProjects(): Promise<ReadonlyArray<RunnerProject>> {
    const projects = await this.loadProjects();
    return projects.map((project) => ({
      id: toRunnerProjectId(project.id),
      displayName: project.displayName,
      setupState: project.setup?.setupState ?? "not-set-up",
    }));
  }

  async readProviderUsage(): Promise<ProviderUsageReading> {
    let result: RemoteResult;
    try {
      result = await this.run([this.config.orcaPath, "account", "list", "--json"]);
    } catch {
      return { kind: "unreadable" };
    }
    if (result.timedOut) return { kind: "unreadable" };
    return parseProviderUsage(result.stdout);
  }

  private async servicePrerequisite(): Promise<RunnerPrerequisite> {
    const base = {
      id: "orca-service",
      name: "Orca background service",
      hint: toRemoteCommand(serviceInstallArgs(this.config.orcaPath)),
      blocksAssignment: false,
    };
    try {
      const service = await this.orca(["serve", "service", "status"], serviceStatusResultSchema);
      return { ...base, satisfied: service.installed && service.verdict === "live" };
    } catch {
      return { ...base, satisfied: null };
    }
  }

  private async pushPrerequisite(project: ProjectRow): Promise<RunnerPrerequisite> {
    const base = {
      id: `github-push:${project.id}`,
      name: `GitHub push access: ${project.displayName}`,
      hint: "Run `gh auth login --insecure-storage` and `gh auth setup-git` on the runner, or add a GitHub SSH key for the runner user.",
      blocksAssignment: false,
      project: toRunnerProjectId(project.id),
    };
    if (project.setup === null || project.setup.setupState !== "ready") {
      return { ...base, satisfied: null };
    }
    const path = project.setup.path;
    let outcome = await this.tryPush(path, project.remoteName);
    if (!outcome.satisfied) {
      await this.sleep(PUSH_RETRY_DELAY_MS);
      outcome = await this.tryPush(path, project.remoteName);
    }
    return { ...base, ...outcome };
  }

  private async tryPush(path: string, projectRemote: string): Promise<PushCheckOutcome> {
    const options = { timeoutMs: Math.min(PUSH_CHECK_TIMEOUT_MS, this.config.commandTimeoutMs) };
    try {
      const config = await this.run(remoteConfigArgv(path), options);
      const remote =
        config.exitCode === 0 ? choosePushRemote(config.stdout, projectRemote) : projectRemote;
      return classifyPush(await this.run(pushArgv(path, remote), options), [path]);
    } catch (error) {
      return unknownPush(error, [path]);
    }
  }

  private async loadProjects(): Promise<ProjectRow[]> {
    const list = await this.orca(["project", "list"], projectListResultSchema);
    const { setups } = await this.orca(["project", "setups"], projectSetupsResultSchema);
    return list.projects.map((project) => {
      const local = setups.filter((s) => s.projectId === project.id && s.hostId === "local");
      const setup = local.find((s) => s.setupState === "ready") ?? local[0] ?? null;
      return {
        id: project.id,
        displayName: project.displayName,
        remoteName: project.gitRemoteIdentity?.remoteName ?? "origin",
        setup:
          setup === null
            ? null
            : { repoId: setup.repoId, path: setup.path, setupState: setup.setupState },
      };
    });
  }

  async ensureMailbox(current: MailboxRef | null): Promise<MailboxRef> {
    const known = current === null ? null : decodeMailbox(current);
    if (current !== null && known !== null) {
      const state = await this.mailboxState(known);
      if (state === "alive") return current;
      if (state === "unbound") {
        const runId = await this.bindRun(known.terminal, known.runId);
        return encodeMailbox({ terminal: known.terminal, runId });
      }
    }

    const handle = await this.createMailboxTerminal();
    try {
      const runId = await this.bindRun(handle, known?.runId ?? null);
      return encodeMailbox({ terminal: handle, runId });
    } catch (error) {
      await this.orcaOutcome(["terminal", "close", "--terminal", handle], z.unknown()).catch(
        () => undefined,
      );
      throw error;
    }
  }

  private async mailboxState(mailbox: OrcaMailbox): Promise<"alive" | "unbound" | "dead"> {
    const shown = await this.orcaOutcome(
      ["terminal", "show", "--terminal", mailbox.terminal],
      terminalShowResultSchema,
    );
    if (!shown.ok) {
      if (shown.code === "terminal_handle_stale") return "dead";
      throw this.errorFor(shown, {});
    }
    if (shown.result.terminal.connected !== true) return "dead";
    const current = await this.orcaOutcome(
      ["orchestration", "run-current", "--from", mailbox.terminal],
      runCurrentResultSchema,
    );
    if (!current.ok) {
      if (current.code === "terminal_handle_stale") return "dead";
      throw this.errorFor(current, {});
    }
    return current.result.runId === mailbox.runId ? "alive" : "unbound";
  }

  private async createMailboxTerminal(): Promise<string> {
    const projects = await this.loadProjects();
    const home =
      projects.find((p) => p.setup?.setupState === "ready")?.setup ??
      projects.find((p) => p.setup !== null)?.setup ??
      null;
    if (home === null) {
      throw new AdapterError<RunnerErrorDetail>({
        kind: "runner-error",
        code: "no_project_for_mailbox",
        message: "the runner has no project to open the mailbox terminal in",
      });
    }
    const created = await this.orca(
      [
        "terminal",
        "create",
        "--worktree",
        `path:${home.path}`,
        "--title",
        MAILBOX_TITLE,
        "--command",
        MAILBOX_COMMAND,
      ],
      terminalCreateResultSchema,
    );
    return created.terminal.handle;
  }

  private async bindRun(handle: string, previousRunId: string | null): Promise<string> {
    if (previousRunId !== null) {
      const used = await this.orcaOutcome(
        ["orchestration", "run-use", "--id", previousRunId, "--from", handle],
        runBindResultSchema,
      );
      if (used.ok) return used.result.runId;
    }
    const created = await this.orca(
      ["orchestration", "run-create", "--objective", RUN_OBJECTIVE, "--from", handle],
      runBindResultSchema,
      { usesMailbox: true },
    );
    return created.runId;
  }

  async startRun(input: StartRunInput): Promise<StartedRun> {
    const mailbox = this.mailboxOf(input.mailbox);
    const projects = await this.loadProjects();
    const setup = projects.find((p) => p.id === input.project)?.setup ?? null;
    if (setup === null) {
      throw new AdapterError<RunnerErrorDetail>({
        kind: "runner-error",
        code: "project_not_found",
        message: `project ${input.project} is not set up on the runner`,
      });
    }

    const args = [
      "orchestration",
      "worker-start",
      "--from",
      mailbox.terminal,
      "--run",
      mailbox.runId,
      "--spec-file",
      "-",
      "--task-title",
      input.worktreeName,
      "--worktree",
      "new-top-level",
      "--repo",
      `id:${setup.repoId}`,
      "--name",
      input.worktreeName,
      "--agent",
      input.agent,
      ...(input.baseBranch === undefined ? [] : ["--base-branch", input.baseBranch]),
      ...modelArgs(input.model ?? this.config.model),
      ...(input.ticket === undefined
        ? []
        : ["--comment", `${input.ticket.key} ${input.ticket.url}`]),
    ];
    let started: z.infer<typeof workerStartResultSchema>;
    try {
      started = await this.orca(args, workerStartResultSchema, {
        stdin: briefFor(input.prompt),
        timeoutMs: this.config.startTimeoutMs,
        usesMailbox: true,
      });
    } catch (error) {
      const detail = detailOf(error);
      if (detail.kind === "unreachable" || detail.kind === "malformed-output") {
        throw new AdapterError<RunnerErrorDetail>(
          {
            kind: "start-outcome-unknown",
            detail: detail.kind === "unreachable" ? detail.detail : detail.raw,
          },
          { cause: error },
        );
      }
      throw error;
    }
    if (started.state !== "ready") {
      throw new AdapterError<RunnerErrorDetail>(
        started.state === "failed"
          ? {
              kind: "runner-error",
              code: "worker_start_failed",
              message: "worker-start ended in state failed",
            }
          : {
              kind: "start-outcome-unknown",
              detail: `worker-start ended in state ${started.state}`,
            },
      );
    }
    const agent = { dispatchId: started.dispatchId, taskId: started.taskId, runId: started.runId };
    const selector =
      started.workspace === null || started.workspace === undefined
        ? `name:${input.worktreeName}`
        : `id:${started.workspace}`;
    try {
      return await this.startedRunAt(selector, agent);
    } catch (error) {
      throw new AdapterError<RunnerErrorDetail>(
        {
          kind: "start-outcome-unknown",
          detail: `started but could not read the worktree: ${String(error)}`,
        },
        { cause: error },
      );
    }
  }

  async findStartedRun(input: {
    mailbox: MailboxRef;
    worktreeName: string;
  }): Promise<StartedRun | null> {
    const shown = await this.orcaOutcome(
      ["worktree", "show", "--worktree", `name:${input.worktreeName}`],
      worktreeShowResultSchema,
    );
    if (!shown.ok) {
      if (shown.code === "selector_not_found") return null;
      throw this.errorFor(shown, {});
    }
    const worktree = shown.result.worktree;
    const mailbox = decodeMailbox(input.mailbox);
    const worker =
      (mailbox === null ? undefined : await this.findWorker(worktree.id, mailbox.runId)) ??
      (await this.findWorker(worktree.id, null));
    if (worker === undefined) {
      throw new AdapterError<RunnerErrorDetail>({
        kind: "runner-error",
        code: "worktree_without_agent",
        message: `worktree ${input.worktreeName} exists but no agent was found for it`,
      });
    }
    const shownWorker = await this.orca(
      ["orchestration", "worker-show", "--dispatch", worker.dispatchId],
      workerShowResultSchema,
    );
    return {
      worktree: toWorktreeRef(worktree.id),
      branch: branchName(worktree.branch, worktree.id),
      agentRef: encodeAgent({
        dispatchId: worker.dispatchId,
        taskId: worker.taskId,
        runId: shownWorker.runId,
      }),
    };
  }

  private async findWorker(
    worktreeId: string,
    runId: string | null,
  ): Promise<{ dispatchId: string; taskId: string } | undefined> {
    let cursor: string | null = null;
    for (let page = 0; page < WORKER_LIST_MAX_PAGES; page += 1) {
      const result: z.infer<typeof workerListResultSchema> = await this.orca(
        [
          "orchestration",
          "worker-list",
          ...(runId === null ? [] : ["--run", runId]),
          "--limit",
          "100",
          ...(cursor === null ? [] : ["--cursor", cursor]),
        ],
        workerListResultSchema,
      );
      const found = result.workers.find((w) => w.workspace === worktreeId);
      if (found !== undefined) return found;
      const next = result.nextCursor ?? null;
      if (next === null || next === cursor || result.workers.length === 0) return undefined;
      cursor = next;
    }
    return undefined;
  }

  private async startedRunAt(selector: string, agent: OrcaAgent): Promise<StartedRun> {
    const { worktree } = await this.orca(
      ["worktree", "show", "--worktree", selector],
      worktreeShowResultSchema,
    );
    return {
      worktree: toWorktreeRef(worktree.id),
      branch: branchName(worktree.branch, worktree.id),
      agentRef: encodeAgent(agent),
    };
  }

  async pollRun(run: RunOnRunner): Promise<RunProgress> {
    const agent = this.agentOf(run);
    const mailbox = this.mailboxOf(run.mailbox);
    const worker = await this.orca(
      ["orchestration", "worker-show", "--dispatch", agent.dispatchId],
      workerShowResultSchema,
    );
    const taskResult = worker.state === "ready" ? null : await this.taskResult(agent);
    if (completionReport(taskResult) !== null) {
      return decideProgress({
        dispatchId: agent.dispatchId,
        taskResult,
        worker,
        mails: [],
        worktreeRow: "unknown",
        worktreeExists: null,
      });
    }
    const mails = await this.readMail(mailbox, agent);
    const worktreeRow = await this.worktreeRow(run.worktree);
    const worktreeExists =
      worktreeRow === null || worktreeRow === "unknown"
        ? await this.worktreeExists(run.worktree)
        : true;
    return decideProgress({
      dispatchId: agent.dispatchId,
      taskResult,
      worker,
      mails,
      worktreeRow,
      worktreeExists,
    });
  }

  private async taskResult(agent: OrcaAgent): Promise<string | Record<string, unknown> | null> {
    const { tasks } = await this.orca(
      ["orchestration", "task-list", "--run", agent.runId, "--full", "--brief"],
      taskListResultSchema,
    );
    return tasks.find((task) => task.id === agent.taskId)?.result ?? null;
  }

  private async readMail(mailbox: OrcaMailbox, agent: OrcaAgent): Promise<ReadonlyArray<MailRow>> {
    if (mailbox.runId === agent.runId) {
      const checked = await this.orca(
        ["orchestration", "check", "--terminal", mailbox.terminal, "--peek", "--full"],
        checkResultSchema,
        { usesMailbox: true },
      );
      return checked.messages;
    }
    const inbox = await this.orca(
      ["orchestration", "inbox", "--terminal", `run:${agent.runId}`, "--limit", "500", "--full"],
      checkResultSchema,
    );
    return inbox.messages;
  }

  private async worktreeRow(
    worktree: WorktreeRef,
  ): Promise<z.infer<typeof worktreePsResultSchema>["worktrees"][number] | null | "unknown"> {
    const ps = await this.orca(
      ["worktree", "ps", "--agent-wait", "--limit", String(WORKTREE_PS_LIMIT)],
      worktreePsResultSchema,
    );
    const row = ps.worktrees.find((w) => w.worktreeId === worktree);
    if (row !== undefined) return row;
    return ps.truncated === true ? "unknown" : null;
  }

  async answerQuestion(
    run: RunOnRunner,
    input: { questionId: QuestionId; answer: string },
  ): Promise<void> {
    const agent = this.agentOf(run);
    const mailbox = this.mailboxOf(run.mailbox);
    await this.orca(
      [
        "orchestration",
        "reply",
        "--from",
        mailbox.terminal,
        ...(mailbox.runId === agent.runId ? [] : ["--run", agent.runId]),
        "--id",
        input.questionId,
        "--body",
        input.answer,
      ],
      replyResultSchema,
      { usesMailbox: true },
    );
  }

  async denyPermission(
    run: RunOnRunner,
    input: { permissionId: PermissionRequestId; reason: string },
  ): Promise<void> {
    const agent = this.agentOf(run);
    const mailbox = this.mailboxOf(run.mailbox);
    await this.orca(
      [
        "orchestration",
        "deny",
        "--from",
        mailbox.terminal,
        "--dispatch",
        agent.dispatchId,
        "--prompt",
        input.permissionId,
        "--reason",
        input.reason,
      ],
      denyResultSchema,
      { usesMailbox: true },
    );
  }

  async stopAgent(run: RunOnRunner): Promise<void> {
    const agent = this.agentOf(run);
    await this.orca(
      ["orchestration", "worker-stop", "--dispatch", agent.dispatchId],
      workerStopResultSchema,
    );
  }

  async closeAgent(run: RunOnRunner): Promise<void> {
    const agent = this.agentOf(run);
    await this.orca(
      ["orchestration", "worker-release", "--dispatch", agent.dispatchId],
      workerReleaseResultSchema,
    );
  }

  async readLogTail(run: RunOnRunner, opts: { lines: number }): Promise<ReadonlyArray<string>> {
    if (opts.lines <= 0) return [];
    const agent = this.agentOf(run);
    let lines: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < LOG_MAX_PAGES; page += 1) {
      const result: z.infer<typeof workerReadResultSchema> = await this.orca(
        [
          "orchestration",
          "worker-read",
          "--dispatch",
          agent.dispatchId,
          "--limit",
          String(LOG_PAGE_SIZE),
          ...(cursor === null ? [] : ["--cursor", cursor]),
        ],
        workerReadResultSchema,
      );
      lines = [...lines, ...workerReadLines(result)].slice(-opts.lines);
      const transcript = result.transcript;
      const next = transcript?.nextCursor ?? null;
      if (
        transcript === null ||
        transcript === undefined ||
        next === null ||
        next === cursor ||
        transcript.messages.length < LOG_PAGE_SIZE
      ) {
        return lines;
      }
      cursor = next;
    }
    return [LOG_CUT_MARKER, ...(opts.lines > 1 ? lines.slice(-(opts.lines - 1)) : [])];
  }

  async worktreeExists(worktree: WorktreeRef): Promise<boolean> {
    const shown = await this.orcaOutcome(
      ["worktree", "show", "--worktree", `id:${worktree}`],
      worktreeShowResultSchema,
    );
    if (shown.ok) return true;
    if (shown.code === "selector_not_found") return false;
    throw this.errorFor(shown, {});
  }

  async removeWorktree(worktree: WorktreeRef): Promise<void> {
    const removed = await this.orcaOutcome(
      ["worktree", "rm", "--worktree", `id:${worktree}`, "--force"],
      worktreeRmResultSchema,
    );
    if (removed.ok || removed.code === "selector_not_found") return;
    throw this.errorFor(removed, {});
  }

  private mailboxOf(ref: MailboxRef): OrcaMailbox {
    const mailbox = decodeMailbox(ref);
    if (mailbox === null) {
      throw new AdapterError<RunnerErrorDetail>({
        kind: "mailbox-missing",
        detail: "the mailbox reference was not made by the orca runner",
      });
    }
    return mailbox;
  }

  private agentOf(run: RunOnRunner): OrcaAgent {
    const agent = decodeAgent(run.agentRef);
    if (agent === null) {
      throw new AdapterError<RunnerErrorDetail>({
        kind: "runner-error",
        code: "invalid_agent_ref",
        message: "the agent reference was not made by the orca runner",
      });
    }
    return agent;
  }

  private async orca<T>(
    args: ReadonlyArray<string>,
    schema: z.ZodType<T>,
    options: CallOptions = {},
  ): Promise<T> {
    const outcome = await this.orcaOutcome(args, schema, options);
    if (!outcome.ok) throw this.errorFor(outcome, options);
    return outcome.result;
  }

  private async orcaOutcome<T>(
    args: ReadonlyArray<string>,
    schema: z.ZodType<T>,
    options: CallOptions = {},
  ): Promise<Outcome<T>> {
    const result = await this.run([this.config.orcaPath, ...args, "--json"], options);
    if (result.timedOut) {
      throw unreachable(`timed out: orca ${args.slice(0, 2).join(" ")}`);
    }
    if (result.exitCode === 255) throw unreachable(result.stderr.trim() || "ssh exited with 255");
    if (result.exitCode === 127) {
      throw new AdapterError<RunnerErrorDetail>({
        kind: "not-installed",
        detail: result.stderr.trim() || `orca not found at ${this.config.orcaPath}`,
      });
    }
    const envelope = envelopeSchema.safeParse(parseJson(result.stdout));
    if (!envelope.success) throw malformed(result);
    if (!envelope.data.ok) {
      return {
        ok: false,
        code: envelope.data.error.code,
        message: envelope.data.error.message ?? "",
      };
    }
    const parsed = schema.safeParse(envelope.data.result);
    if (!parsed.success) throw malformed(result);
    return { ok: true, result: parsed.data };
  }

  private errorFor(
    outcome: { code: string; message: string },
    options: CallOptions,
  ): AdapterError<RunnerErrorDetail> {
    if (outcome.code === "runtime_unavailable") {
      return new AdapterError<RunnerErrorDetail>({ kind: "not-ready", detail: outcome.message });
    }
    if (options.usesMailbox === true && SENDER_ERROR_CODES.has(outcome.code)) {
      return new AdapterError<RunnerErrorDetail>({
        kind: "mailbox-missing",
        detail: `${outcome.code}: ${outcome.message}`,
      });
    }
    return new AdapterError<RunnerErrorDetail>({
      kind: "runner-error",
      code: outcome.code,
      message: outcome.message,
    });
  }

  private async run(argv: ReadonlyArray<string>, options: CallOptions = {}): Promise<RemoteResult> {
    let command: string;
    try {
      command = toRemoteCommand(argv);
    } catch (error) {
      if (error instanceof RemoteCommandTooLongError) {
        throw new AdapterError<RunnerErrorDetail>(
          { kind: "runner-error", code: "argument_too_long", message: error.message },
          { cause: error },
        );
      }
      throw error;
    }
    try {
      return await this.exec.run(command, {
        timeoutMs: options.timeoutMs ?? this.config.commandTimeoutMs,
        ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
      });
    } catch (error) {
      throw new AdapterError<RunnerErrorDetail>(
        { kind: "unreachable", detail: `could not run ssh: ${String(error)}` },
        { cause: error },
      );
    }
  }
}

export const orcaRunnerFactory: RunnerFactory = {
  kind: ORCA_RUNNER_KIND,
  create(config: unknown): Runner {
    return new OrcaRunner(parseOrcaRunnerConfig(config));
  },
};

function modelArgs(model: string | undefined): string[] {
  return model === undefined ? [] : ["--model", model];
}

function branchName(ref: string | null | undefined, worktree: string): string {
  if (ref === null || ref === undefined || ref.length === 0) {
    throw new AdapterError<RunnerErrorDetail>({
      kind: "malformed-output",
      raw: `worktree ${worktree} has no branch`,
    });
  }
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

function detailOf(error: unknown): RunnerErrorDetail {
  if (error instanceof AdapterError) {
    const detail: unknown = error.detail;
    if (isRunnerErrorDetail(detail)) return detail;
  }
  return { kind: "unreachable", detail: String(error) };
}

function isRunnerErrorDetail(detail: unknown): detail is RunnerErrorDetail {
  if (typeof detail !== "object" || detail === null || !("kind" in detail)) return false;
  switch (detail.kind) {
    case "unreachable":
    case "not-installed":
    case "not-ready":
    case "mailbox-missing":
    case "runner-error":
    case "start-outcome-unknown":
    case "malformed-output":
      return true;
    default:
      return false;
  }
}

function unreachable(detail: string): AdapterError<RunnerErrorDetail> {
  return new AdapterError<RunnerErrorDetail>({ kind: "unreachable", detail });
}

function malformed(result: RemoteResult): AdapterError<RunnerErrorDetail> {
  const raw = `${result.stdout}${result.stderr === "" ? "" : `\n[stderr] ${result.stderr}`}`;
  return new AdapterError<RunnerErrorDetail>({
    kind: "malformed-output",
    raw: raw.slice(0, RAW_LIMIT),
  });
}

function parseJson(value: string): unknown {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    return null;
  }
}
