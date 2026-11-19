import { AdapterError } from "../adapters.js";
import type { ProviderUsageReading } from "../provider-usage.js";
import type {
  AgentQuestion,
  CodeHost,
  CodeHostErrorDetail,
  CompletionReport,
  ConnectionCheck,
  Page,
  Paged,
  PermissionWait,
  PullRequestSnapshot,
  ResumeAgentInput,
  ResumedAgent,
  RunOnRunner,
  RunProgress,
  Runner,
  RunnerErrorDetail,
  RunnerHealth,
  RunnerPrerequisite,
  RunnerProject,
  StartRunInput,
  StartedRun,
  Tracker,
  TrackerComment,
  TrackerConnectionCheck,
  TrackerEvent,
  TrackerLabel,
  TrackerProject,
  TrackerState,
  TrackerTicket,
  WebhookVerifyError,
} from "../adapters.js";
import {
  toAgentRef,
  toCodeHostKind,
  toCommentId,
  toMailboxRef,
  toPermissionRequestId,
  toQuestionId,
  toRepoRef,
  toRunnerKind,
  toTrackerKind,
  toWorktreeRef,
} from "../ids.js";
import type {
  CodeHostKind,
  CommentId,
  LabelId,
  MailboxRef,
  PermissionRequestId,
  PullRequestId,
  QuestionId,
  RepoRef,
  RunnerKind,
  RunnerProjectId,
  TicketKey,
  TrackerKind,
  TrackerProjectId,
  TrackerStateId,
  WorktreeRef,
} from "../ids.js";
import { mentionsTicketKey } from "../pr-state.js";
import type { CodeHostFactory, RunnerFactory, TrackerFactory } from "../registry.js";

function paginate<T>(all: ReadonlyArray<T>, page: Page | undefined): Paged<T> {
  const start = page?.after === undefined ? 0 : Number(page.after);
  const end = page?.first === undefined ? all.length : start + page.first;
  return {
    items: all.slice(start, end),
    nextCursor: end < all.length ? String(end) : null,
  };
}

type WebhookResult = { ok: true; event: TrackerEvent } | { ok: false; error: WebhookVerifyError };

export class FakeTracker implements Tracker {
  readonly kind: TrackerKind;
  readonly tickets = new Map<TicketKey, TrackerTicket>();
  readonly comments = new Map<TicketKey, TrackerComment[]>();
  readonly projects: TrackerProject[] = [];
  readonly labels = new Map<TrackerProjectId, TrackerLabel[]>();
  readonly states = new Map<TrackerProjectId, TrackerState[]>();
  readonly stateChanges: Array<{ key: TicketKey; stateId: TrackerStateId }> = [];
  connection: TrackerConnectionCheck = { ok: true, organizationName: null };
  verifyWebhookWith: (input: { rawBody: Uint8Array; now: Date }) => WebhookResult = () => ({
    ok: false,
    error: "malformed",
  });
  private commentSeq = 0;

  constructor(kind: TrackerKind = toTrackerKind("fake")) {
    this.kind = kind;
  }

  addTicket(ticket: TrackerTicket): void {
    this.tickets.set(ticket.key, ticket);
  }

  checkConnection(): Promise<TrackerConnectionCheck> {
    return Promise.resolve(this.connection);
  }

  verifyWebhook(input: {
    rawBody: Uint8Array;
    headers: Readonly<Record<string, string | undefined>>;
    now: Date;
  }): WebhookResult {
    return this.verifyWebhookWith(input);
  }

  getTicket(key: TicketKey): Promise<TrackerTicket | null> {
    return Promise.resolve(this.tickets.get(key) ?? null);
  }

  listProjectTickets(projectId: TrackerProjectId, page?: Page): Promise<Paged<TrackerTicket>> {
    const all = [...this.tickets.values()].filter((ticket) => ticket.project?.id === projectId);
    return Promise.resolve(paginate(all, page));
  }

  listLabeledTickets(input: {
    labelId: LabelId;
    updatedSince: Date;
  }): Promise<ReadonlyArray<TrackerTicket>> {
    return Promise.resolve(
      [...this.tickets.values()].filter(
        (ticket) =>
          ticket.labels.some((label) => label.id === input.labelId) &&
          ticket.updatedAt.getTime() >= input.updatedSince.getTime(),
      ),
    );
  }

  listComments(key: TicketKey, page?: Page): Promise<Paged<TrackerComment>> {
    return Promise.resolve(paginate(this.comments.get(key) ?? [], page));
  }

  listProjects(): Promise<ReadonlyArray<TrackerProject>> {
    return Promise.resolve(this.projects);
  }

  listLabels(projectId: TrackerProjectId): Promise<ReadonlyArray<TrackerLabel>> {
    return Promise.resolve(this.labels.get(projectId) ?? []);
  }

  listStates(projectId: TrackerProjectId): Promise<ReadonlyArray<TrackerState>> {
    return Promise.resolve(this.states.get(projectId) ?? []);
  }

  setState(key: TicketKey, stateId: TrackerStateId): Promise<void> {
    const ticket = this.tickets.get(key);
    if (ticket === undefined) return Promise.reject(new AdapterError({ kind: "not-found" }));
    const state = [...this.states.values()].flat().find((s) => s.id === stateId);
    if (state !== undefined) this.tickets.set(key, { ...ticket, state });
    this.stateChanges.push({ key, stateId });
    return Promise.resolve();
  }

  addComment(key: TicketKey, body: string): Promise<{ id: CommentId; url: string }> {
    const ticket = this.tickets.get(key);
    if (ticket === undefined) return Promise.reject(new AdapterError({ kind: "not-found" }));
    this.commentSeq += 1;
    const id = toCommentId(`comment-${this.commentSeq}`);
    const list = this.comments.get(key) ?? [];
    list.push({ id, body, createdAt: new Date(), author: null });
    this.comments.set(key, list);
    return Promise.resolve({ id, url: `${ticket.url}#${id}` });
  }
}

export interface FakeRunnerRun {
  input: StartRunInput;
  started: StartedRun;
  questions: AgentQuestion[];
  answers: Array<{ questionId: QuestionId; answer: string }>;
  permissionWaits: PermissionWait[];
  denials: Array<{ permissionId: PermissionRequestId; reason: string }>;
  report: CompletionReport | null;
  endedWithoutReport: string | null;
  agentStopped: boolean;
  agentClosed: boolean;
  paused: boolean;
  resumes: ResumeAgentInput[];
  log: string[];
}

export class FakeRunner implements Runner {
  readonly kind: RunnerKind;
  readonly runs = new Map<string, FakeRunnerRun>();
  readonly removed: WorktreeRef[] = [];
  readonly startCalls: StartRunInput[] = [];
  online = true;
  prerequisites: RunnerPrerequisite[] = [
    {
      id: "fake-service",
      name: "fake service",
      satisfied: true,
      hint: null,
      blocksAssignment: false,
    },
    {
      id: "fake-push-auth",
      name: "fake push auth",
      satisfied: true,
      hint: null,
      blocksAssignment: true,
    },
  ];
  projects: RunnerProject[] = [];
  providerUsage: ProviderUsageReading = { kind: "read", providers: [] };
  failNextStart: RunnerErrorDetail | null = null;
  failNextControl: RunnerErrorDetail | null = null;
  loseNextStartResponse = false;
  private readonly mailboxes = new Set<MailboxRef>();
  private seq = 0;

  constructor(kind: RunnerKind = toRunnerKind("fake")) {
    this.kind = kind;
  }

  setProjects(projects: ReadonlyArray<RunnerProject>): void {
    this.projects = [...projects];
  }

  dropMailbox(mailbox: MailboxRef): void {
    this.mailboxes.delete(mailbox);
  }

  runAt(worktree: WorktreeRef): FakeRunnerRun {
    for (const run of this.runs.values()) {
      if (run.started.worktree === worktree) return run;
    }
    throw new AdapterError<RunnerErrorDetail>({
      kind: "runner-error",
      code: "worktree_not_found",
      message: `unknown worktree ${worktree}`,
    });
  }

  ask(
    worktree: WorktreeRef,
    question: { body: string; options?: string[]; at?: Date },
  ): QuestionId {
    const run = this.runAt(worktree);
    const id = toQuestionId(`fake-question-${this.next()}`);
    run.questions.push({
      id,
      body: question.body,
      options: question.options ?? [],
      askedAt: question.at ?? new Date(),
    });
    return id;
  }

  requestPermission(worktree: WorktreeRef, detail: string, at?: Date): PermissionRequestId {
    const id = toPermissionRequestId(`fake-permission-${this.next()}`);
    this.runAt(worktree).permissionWaits.push({ id, detail, requestedAt: at ?? new Date() });
    return id;
  }

  allowPermission(worktree: WorktreeRef, id: PermissionRequestId): void {
    const run = this.runAt(worktree);
    run.permissionWaits = run.permissionWaits.filter((p) => p.id !== id);
  }

  report(
    worktree: WorktreeRef,
    report: { outcome: CompletionReport["outcome"]; body?: string; at?: Date },
  ): void {
    this.runAt(worktree).report = {
      outcome: report.outcome,
      body: report.body ?? "",
      reportedAt: report.at ?? null,
    };
  }

  vanish(worktree: WorktreeRef, detail = "agent terminal is gone"): void {
    this.runAt(worktree).endedWithoutReport = detail;
  }

  deleteWorktree(worktree: WorktreeRef): void {
    for (const [name, run] of this.runs) {
      if (run.started.worktree === worktree) this.runs.delete(name);
    }
  }

  appendLog(worktree: WorktreeRef, ...lines: string[]): void {
    this.runAt(worktree).log.push(...lines);
  }

  checkHealth(): Promise<RunnerHealth> {
    return Promise.resolve({
      online: this.online,
      version: this.online ? "fake" : null,
      prerequisites: this.online
        ? this.prerequisites
        : this.prerequisites.map((p) => ({ ...p, satisfied: null })),
      checkedAt: new Date(),
      error: this.online ? null : unreachable(),
    });
  }

  listProjects(): Promise<ReadonlyArray<RunnerProject>> {
    return this.reach(() => this.projects);
  }

  readProviderUsage(): Promise<ProviderUsageReading> {
    return this.reach(() => this.providerUsage);
  }

  ensureMailbox(current: MailboxRef | null): Promise<MailboxRef> {
    return this.reach(() => {
      if (current !== null && this.mailboxes.has(current)) return current;
      const mailbox = toMailboxRef(`fake-mailbox-${this.next()}`);
      this.mailboxes.add(mailbox);
      return mailbox;
    });
  }

  startRun(input: StartRunInput): Promise<StartedRun> {
    return this.reach(() => {
      this.startCalls.push(input);
      const failure = this.failNextStart;
      if (failure !== null) {
        this.failNextStart = null;
        throw new AdapterError(failure);
      }
      this.mustHaveMailbox(input.mailbox);
      if (this.runs.has(input.worktreeName)) {
        throw new AdapterError<RunnerErrorDetail>({
          kind: "runner-error",
          code: "worktree_exists",
          message: `worktree ${input.worktreeName} already exists`,
        });
      }
      if (!this.projects.some((project) => project.id === input.project)) {
        throw new AdapterError<RunnerErrorDetail>({
          kind: "runner-error",
          code: "project_not_found",
          message: `unknown project ${input.project}`,
        });
      }
      const n = this.next();
      const started: StartedRun = {
        worktree: toWorktreeRef(`fake::/fake/${input.worktreeName}`),
        branch: `fake/${input.worktreeName}`,
        agentRef: toAgentRef(`fake-agent-${n}`),
      };
      this.runs.set(input.worktreeName, {
        input,
        started,
        questions: [],
        answers: [],
        permissionWaits: [],
        denials: [],
        report: null,
        endedWithoutReport: null,
        agentStopped: false,
        agentClosed: false,
        paused: false,
        resumes: [],
        log: [],
      });
      if (this.loseNextStartResponse) {
        this.loseNextStartResponse = false;
        throw new AdapterError<RunnerErrorDetail>({
          kind: "start-outcome-unknown",
          detail: "fake runner lost the response",
        });
      }
      return started;
    });
  }

  findStartedRun(input: { mailbox: MailboxRef; worktreeName: string }): Promise<StartedRun | null> {
    return this.reach(() => this.runs.get(input.worktreeName)?.started ?? null);
  }

  pollRun(run: RunOnRunner): Promise<RunProgress> {
    return this.reach((): RunProgress => {
      const found = this.find(run.worktree);
      if (found === null) return { kind: "worktree-gone" };
      if (found.report !== null) return { kind: "reported", report: found.report };
      if (found.endedWithoutReport !== null) {
        return { kind: "ended-without-report", detail: found.endedWithoutReport };
      }
      return {
        kind: "active",
        questions: [...found.questions],
        permissionWaits: [...found.permissionWaits],
      };
    });
  }

  answerQuestion(
    run: RunOnRunner,
    input: { questionId: QuestionId; answer: string },
  ): Promise<void> {
    return this.reach(() => {
      this.mustHaveMailbox(run.mailbox);
      const found = this.runAt(run.worktree);
      if (!found.questions.some((q) => q.id === input.questionId)) {
        throw new AdapterError<RunnerErrorDetail>({
          kind: "runner-error",
          code: "message_not_found",
          message: `unknown question ${input.questionId}`,
        });
      }
      found.answers.push({ ...input });
    });
  }

  denyPermission(
    run: RunOnRunner,
    input: { permissionId: PermissionRequestId; reason: string },
  ): Promise<void> {
    return this.reach(() => {
      this.mustHaveMailbox(run.mailbox);
      const found = this.runAt(run.worktree);
      found.permissionWaits = found.permissionWaits.filter((p) => p.id !== input.permissionId);
      found.denials.push({ ...input });
    });
  }

  pauseAgent(run: RunOnRunner): Promise<void> {
    return this.reach(() => {
      this.takeControlFailure();
      const found = this.runAt(run.worktree);
      if (found.endedWithoutReport !== null) {
        throw new AdapterError<RunnerErrorDetail>({
          kind: "runner-error",
          code: "agent_not_running",
          message: "the agent is not running",
        });
      }
      found.paused = true;
    });
  }

  resumeAgent(run: RunOnRunner, input: ResumeAgentInput): Promise<ResumedAgent> {
    return this.reach((): ResumedAgent => {
      this.takeControlFailure();
      this.mustHaveMailbox(run.mailbox);
      const found = this.runAt(run.worktree);
      found.resumes.push({ ...input });
      found.paused = false;
      if (found.endedWithoutReport === null) {
        return { agentRef: found.started.agentRef, restarted: false };
      }
      const agentRef = toAgentRef(`fake-agent-${this.next()}`);
      found.started = { ...found.started, agentRef };
      found.endedWithoutReport = null;
      found.agentStopped = false;
      return { agentRef, restarted: true };
    });
  }

  stopAgent(run: RunOnRunner): Promise<void> {
    return this.reach(() => {
      const found = this.runAt(run.worktree);
      found.agentStopped = true;
      found.endedWithoutReport ??= "stopped by the orchestrator";
    });
  }

  closeAgent(run: RunOnRunner): Promise<void> {
    return this.reach(() => {
      this.runAt(run.worktree).agentClosed = true;
    });
  }

  readLogTail(run: RunOnRunner, opts: { lines: number }): Promise<ReadonlyArray<string>> {
    return this.reach(() => {
      const log = this.runAt(run.worktree).log;
      return opts.lines <= 0 ? [] : log.slice(-opts.lines);
    });
  }

  worktreeExists(worktree: WorktreeRef): Promise<boolean> {
    return this.reach(() => this.find(worktree) !== null);
  }

  removeWorktree(worktree: WorktreeRef): Promise<void> {
    return this.reach(() => {
      this.deleteWorktree(worktree);
      this.removed.push(worktree);
    });
  }

  private find(worktree: WorktreeRef): FakeRunnerRun | null {
    for (const run of this.runs.values()) {
      if (run.started.worktree === worktree) return run;
    }
    return null;
  }

  private takeControlFailure(): void {
    const failure = this.failNextControl;
    if (failure === null) return;
    this.failNextControl = null;
    throw new AdapterError(failure);
  }

  private mustHaveMailbox(mailbox: MailboxRef): void {
    if (!this.mailboxes.has(mailbox)) {
      throw new AdapterError<RunnerErrorDetail>({
        kind: "mailbox-missing",
        detail: `unknown mailbox ${mailbox}`,
      });
    }
  }

  private next(): number {
    this.seq += 1;
    return this.seq;
  }

  private reach<T>(fn: () => T): Promise<T> {
    if (!this.online) return Promise.reject(new AdapterError(unreachable()));
    try {
      return Promise.resolve(fn());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

function unreachable(): RunnerErrorDetail {
  return { kind: "unreachable", detail: "fake runner is offline" };
}

export class FakeCodeHost implements CodeHost {
  readonly kind: CodeHostKind;
  connection: ConnectionCheck<CodeHostErrorDetail> = { ok: true };
  rateLimitValue: { limit: number; remaining: number; resetAt: Date } | null = null;
  private readonly prs = new Map<RepoRef, PullRequestSnapshot[]>();
  private readonly projectPrefix: string;

  constructor(kind: CodeHostKind = toCodeHostKind("fake"), projectPrefix = "fake:") {
    this.kind = kind;
    this.projectPrefix = projectPrefix;
  }

  putPullRequest(repo: RepoRef, pr: PullRequestSnapshot): void {
    const list = (this.prs.get(repo) ?? []).filter((p) => p.id !== pr.id);
    list.push(pr);
    this.prs.set(repo, list);
  }

  checkConnection(): Promise<ConnectionCheck<CodeHostErrorDetail>> {
    return Promise.resolve(this.connection);
  }

  repoOf(project: RunnerProjectId): RepoRef | null {
    if (!project.startsWith(this.projectPrefix)) return null;
    const name = project.slice(this.projectPrefix.length);
    return name.length === 0 ? null : toRepoRef(name);
  }

  findPullRequestsByBranch(
    repo: RepoRef,
    branch: string,
  ): Promise<ReadonlyArray<PullRequestSnapshot>> {
    return Promise.resolve(this.list(repo).filter((pr) => pr.headBranch === branch));
  }

  findPullRequestsByTicketKey(
    repo: RepoRef,
    ticketKey: TicketKey,
    opts: { createdSince: Date },
  ): Promise<ReadonlyArray<PullRequestSnapshot>> {
    return Promise.resolve(
      this.list(repo).filter(
        (pr) =>
          (mentionsTicketKey(pr.title, ticketKey) || mentionsTicketKey(pr.body, ticketKey)) &&
          pr.createdAt.getTime() >= opts.createdSince.getTime(),
      ),
    );
  }

  getPullRequest(repo: RepoRef, id: PullRequestId): Promise<PullRequestSnapshot | null> {
    return Promise.resolve(this.list(repo).find((pr) => pr.id === id) ?? null);
  }

  rateLimit(): Promise<{ limit: number; remaining: number; resetAt: Date } | null> {
    return Promise.resolve(this.rateLimitValue);
  }

  private list(repo: RepoRef): ReadonlyArray<PullRequestSnapshot> {
    return this.prs.get(repo) ?? [];
  }
}

export interface FakeFactory<F, A> {
  readonly factory: F;
  readonly created: A[];
}

export function fakeTrackerFactory(
  kind: TrackerKind = toTrackerKind("fake"),
): FakeFactory<TrackerFactory, FakeTracker> {
  const created: FakeTracker[] = [];
  return {
    created,
    factory: {
      kind,
      create: () => {
        const tracker = new FakeTracker(kind);
        created.push(tracker);
        return tracker;
      },
    },
  };
}

export function fakeRunnerFactory(
  kind: RunnerKind = toRunnerKind("fake"),
): FakeFactory<RunnerFactory, FakeRunner> {
  const created: FakeRunner[] = [];
  return {
    created,
    factory: {
      kind,
      create: () => {
        const runner = new FakeRunner(kind);
        created.push(runner);
        return runner;
      },
    },
  };
}

export function fakeCodeHostFactory(
  kind: CodeHostKind = toCodeHostKind("fake"),
  projectPrefix = "fake:",
): FakeFactory<CodeHostFactory, FakeCodeHost> {
  const created: FakeCodeHost[] = [];
  return {
    created,
    factory: {
      kind,
      create: () => {
        const codeHost = new FakeCodeHost(kind, projectPrefix);
        created.push(codeHost);
        return codeHost;
      },
    },
  };
}
