import { AdapterError, toRunnerKind, toRunnerProjectId, toWorktreeRef } from "@factory/core";
import type {
  MailboxRef,
  PermissionRequestId,
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
} from "@factory/core";
import { z } from "zod";
import { parseOrcaRunnerConfig } from "./config.js";
import type { OrcaRunnerConfig } from "./config.js";
import { workerReadLines } from "./log-tail.js";
import { completionReport, decideProgress } from "./progress.js";
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
import { RemoteCommandTooLongError, toRemoteCommand } from "./shell.js";
import { sshExec } from "./ssh.js";
import type { RemoteExec, RemoteResult } from "./ssh.js";

export const ORCA_RUNNER_KIND: RunnerKind = toRunnerKind("orca");

/** 우편함 터미널 탭 제목과 그것이 돌리는 명령. 터미널에 무엇이 입력돼도 셸 명령으로 돌지 않게 한다(research 0008 1절). */
export const MAILBOX_TITLE = "factory-orchestrator-mailbox";
const MAILBOX_COMMAND = "cat > /dev/null";
const RUN_OBJECTIVE = "factory-orchestrator";
/** GitHub 인증 확인에 쓰는 브랜치. `--dry-run`이라 만들지 않는다 */
export const PUSH_CHECK_REF = "HEAD:refs/heads/factory-orchestrator/push-check";
/** worktree ps 한 번에 받을 행 수. 잘리면(truncated) worktree show로 다시 확인한다 */
const WORKTREE_PS_LIMIT = 500;
/** worker-read 한 쪽의 메시지 수와 끝까지 읽을 때의 쪽 수 상한 */
const LOG_PAGE_SIZE = 100;
const LOG_MAX_PAGES = 20;
/** 오류에 남길 출력의 최대 길이 */
const RAW_LIMIT = 4000;

/** 우편함 신원이 없거나 묶인 Run이 다르다는 오류 코드(research 0008 1절, fixtures/check-peek-consumer-fenced.json) */
const SENDER_ERROR_CODES = new Set([
  "no_active_sender_terminal",
  "terminal_handle_stale",
  "consumer_fenced",
]);

type Outcome<T> = { ok: true; result: T } | { ok: false; code: string; message: string };

interface CallOptions {
  stdin?: string;
  timeoutMs?: number;
  /** `--from`·`--terminal`로 우편함 신원을 쓰는 명령. 신원 오류를 mailbox-missing으로 바꾼다 */
  usesMailbox?: boolean;
}

interface ProjectRow {
  id: string;
  displayName: string;
  remoteName: string;
  setup: { repoId: string; path: string; setupState: string } | null;
}

/**
 * ssh로 러너의 `orca`를 불러 core Runner를 구현한다(ADR 0009, research 0008 「제안: Runner 어댑터 계약」).
 * 모든 orca 명령은 `--json`을 주고 종료 코드가 아니라 봉투의 `ok`·`error.code`로 판단한다. 메일은 소비하지
 * 않고 읽는다(`check --peek`, Q82.5). 5분 연결 끊김 판단은 worker와 core가 한다.
 */
export class OrcaRunner implements Runner {
  readonly kind = ORCA_RUNNER_KIND;
  private readonly config: OrcaRunnerConfig;
  private readonly exec: RemoteExec;

  constructor(config: OrcaRunnerConfig, exec?: RemoteExec) {
    this.config = config;
    this.exec = exec ?? sshExec(config);
  }

  // ---------- 상태 확인과 프로젝트 ----------

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
      for (const project of projects) prerequisites.push(await this.pushPrerequisite(project));
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

  /** Orca 상시 서비스(스펙 9절, Q43). 없어도 Online은 바꾸지 않는다 */
  private async servicePrerequisite(): Promise<RunnerPrerequisite> {
    const base = {
      id: "orca-service",
      name: "Orca background service",
      hint: `${this.config.orcaPath} serve service install --bind 127.0.0.1 --refuse-public --command ${this.config.orcaPath}`,
      blocksAssignment: false,
    };
    try {
      const service = await this.orca(["serve", "service", "status"], serviceStatusResultSchema);
      return { ...base, satisfied: service.installed && service.verdict === "live" };
    } catch {
      return { ...base, satisfied: null };
    }
  }

  /**
   * 러너 쪽 프로젝트 저장소에 비대화형 ssh 세션에서 push할 수 있는지(Q82.15). `git push --dry-run`은
   * 원격의 receive-pack에 인증한 뒤 아무것도 올리지 않는다. 인증을 묻는 프롬프트는 끈다.
   * 실패해도 Online은 바꾸지 않고, 할당에서 빼는 것은 core와 worker가 한다(Q82.14).
   */
  private async pushPrerequisite(project: ProjectRow): Promise<RunnerPrerequisite> {
    const base = {
      id: `github-push:${project.id}`,
      name: `GitHub push access: ${project.displayName}`,
      hint: "Run `gh auth login --insecure-storage` and `gh auth setup-git` on the runner, or add a GitHub SSH key for the runner user.",
      blocksAssignment: true,
    };
    if (project.setup === null) return { ...base, satisfied: null };
    let result: RemoteResult;
    try {
      result = await this.run([
        "env",
        "GIT_TERMINAL_PROMPT=0",
        "GIT_SSH_COMMAND=ssh -o BatchMode=yes",
        "git",
        "-C",
        project.setup.path,
        "push",
        "--dry-run",
        "--porcelain",
        project.remoteName,
        PUSH_CHECK_REF,
      ]);
    } catch {
      return { ...base, satisfied: null };
    }
    if (result.timedOut || result.exitCode === 255 || result.exitCode === null) {
      // ssh가 러너에 닿지 못했다. 확인하지 못한 것이지 깨진 것이 아니다.
      return { ...base, satisfied: null };
    }
    return { ...base, satisfied: result.exitCode === 0 };
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

  // ---------- 우편함 ----------

  async ensureMailbox(current: MailboxRef | null): Promise<MailboxRef> {
    const known = current === null ? null : decodeMailbox(current);
    if (current !== null && known !== null && (await this.mailboxAlive(known))) return current;

    const handle = await this.createMailboxTerminal();
    try {
      const runId = await this.bindRun(handle, known?.runId ?? null);
      return encodeMailbox({ terminal: handle, runId });
    } catch (error) {
      // 신원 없이 남는 터미널을 두지 않는다. 닫지 못해도 원래 오류를 알린다.
      await this.orcaOutcome(["terminal", "close", "--terminal", handle], z.unknown()).catch(
        () => undefined,
      );
      throw error;
    }
  }

  private async mailboxAlive(mailbox: OrcaMailbox): Promise<boolean> {
    const shown = await this.orcaOutcome(
      ["terminal", "show", "--terminal", mailbox.terminal],
      terminalShowResultSchema,
    );
    if (!shown.ok) {
      if (shown.code === "terminal_handle_stale") return false;
      throw this.errorFor(shown, {});
    }
    // 닫힌 터미널도 `terminal show`는 ok이고 connected가 false다(fixtures/terminal-show-closed.json).
    return shown.result.terminal.connected === true;
  }

  /** 우편함 터미널은 러너 쪽 프로젝트의 등록 저장소에 띄운다. 워크트리 없이 만들 수 없다. */
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

  /**
   * 새 우편함 터미널을 오케스트레이션 Run에 코디네이터로 묶는다. 러너마다 Run 하나를 오래 쓰므로(Q82.7)
   * 이전 Run이 있으면 `run-use`로 이어 쓰고, 안 되면 새로 만든다.
   */
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

  // ---------- 시작 ----------

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

    // 사양(티켓)은 ssh stdin으로 `--spec-file -`에 넘긴다. 명령 인자에 넣지 않으므로 인용과 길이 한계를 거치지
    // 않고, 러너에 지울 파일도 남지 않는다(research 0008 「제안」의 파일 업로드를 이 티켓에서 바꿈).
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
      ...(this.config.model === undefined ? [] : ["--model", this.config.model]),
      ...(input.ticket === undefined
        ? []
        : ["--comment", `${input.ticket.key} ${input.ticket.url}`]),
    ];
    let started: z.infer<typeof workerStartResultSchema>;
    try {
      started = await this.orca(args, workerStartResultSchema, {
        stdin: input.prompt,
        timeoutMs: this.config.startTimeoutMs,
        usesMailbox: true,
      });
    } catch (error) {
      // 명령을 보낸 뒤 연결이 끊기면 러너에서 돌았는지 모른다(core start-outcome-unknown).
      const detail = detailOf(error);
      // 출력이 깨진 것도 명령이 돈 뒤일 수 있어 같이 다룬다.
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
      // 실패로 확인된 값만 런이 남지 않았다고 본다. 모르는 값은 결과 모름으로 보내 findStartedRun을 먼저
      // 거치게 한다(CODING_STANDARDS 「외부 열거값은 모르는 값이 와도 깨지지 않게 둔다」).
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
      // 에이전트는 떴다. 브랜치를 읽지 못했으니 findStartedRun으로 이어 붙이게 한다.
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
    // ssh 호출자에는 묶인 Run이 없어 `--run` 없이 부르면 모든 Run의 에이전트가 온다. 우편함으로 좁히지 않는다.
    const { workers } = await this.orca(["orchestration", "worker-list"], workerListResultSchema);
    // worker-list는 최근 것부터 준다. 같은 워크트리에 여러 번 시작했으면 가장 최근 것을 고른다.
    const worker = workers.find((w) => w.workspace === worktree.id);
    if (worker === undefined) return null;
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

  // ---------- 진행 ----------

  async pollRun(run: RunOnRunner): Promise<RunProgress> {
    const agent = this.agentOf(run);
    const mailbox = this.mailboxOf(run.mailbox);
    const worker = await this.orca(
      ["orchestration", "worker-show", "--dispatch", agent.dispatchId],
      workerShowResultSchema,
    );
    // `ready`는 일하는 중이다. 그 밖의 상태(보고로 settled, 사라짐, 모르는 값)에서만 Task 결과를 읽는다.
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
    // `--brief`는 사양을 160자로 줄이고 결과는 그대로 둔다. Run의 Task가 쌓여도 응답이 덜 커진다.
    const { tasks } = await this.orca(
      ["orchestration", "task-list", "--run", agent.runId, "--full", "--brief"],
      taskListResultSchema,
    );
    return tasks.find((task) => task.id === agent.taskId)?.result ?? null;
  }

  /**
   * 메일을 소비하지 않고 읽는다(Q82.5). 소비하는 `check`(`--peek` 없음)는 부르지 않는다. 우편함이 다른
   * Run에 묶였으면(우편함을 다시 만들며 Run을 이어 쓰지 못한 경우) 그 런의 Run 메일함을 `inbox`로 읽는다.
   */
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
      // deny에는 `--run`이 없다(orca help). Dispatch로 대상을 정한다.
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

  // ---------- 멈추기·닫기·정리 ----------

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

  /**
   * `worker-read`는 처음부터 쪽으로 읽으므로 끝까지 넘기며 마지막 줄들을 남긴다. 놓은 뒤에도 보관본을
   * 읽지만 보고 없이 죽은 에이전트는 비어 있을 수 있어 worker가 멈추거나 닫기 전에 부른다(research 0008 6절).
   */
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
        break;
      }
      cursor = next;
    }
    return lines;
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
    // 에이전트가 남긴 파일이 있어도 지운다(research 0003 9절). 브랜치는 남긴다(`--delete-branch` 없음).
    const removed = await this.orcaOutcome(
      ["worktree", "rm", "--worktree", `id:${worktree}`, "--force"],
      worktreeRmResultSchema,
    );
    if (removed.ok || removed.code === "selector_not_found") return;
    throw this.errorFor(removed, {});
  }

  // ---------- ssh와 orca 봉투 ----------

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

  /** orca 명령을 돌려 결과를 스키마로 파싱한다. `ok: false`는 오류 종류로 바꿔 던진다. */
  private async orca<T>(
    args: ReadonlyArray<string>,
    schema: z.ZodType<T>,
    options: CallOptions = {},
  ): Promise<T> {
    const outcome = await this.orcaOutcome(args, schema, options);
    if (!outcome.ok) throw this.errorFor(outcome, options);
    return outcome.result;
  }

  /** orca 명령을 돌린다. ssh·출력 오류는 던지고, `ok: false`는 코드와 함께 돌려준다. */
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

  /** 인자 배열을 한 곳(toRemoteCommand)에서 인용해 ssh로 보낸다. */
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

/** `refs/heads/<name>`에서 브랜치 이름을 꺼낸다. Orca가 러너의 접두사를 붙여 정한 이름이다(Q82.6). */
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

/** 이 어댑터가 던진 AdapterError의 detail인지. 다른 어댑터·코드의 오류는 러너에 닿지 못한 것으로 다룬다 */
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
