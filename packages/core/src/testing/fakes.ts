/**
 * 테스트용 가짜 어댑터. 메모리 안에서 동작하고, 테스트가 응답을 정할 수 있다.
 * worker 시험(0006·0016)과 끝에서 끝까지 얇은 경로(0008)가 이것으로 돈다.
 *
 * 각 가짜는 종류(kind)를 받아 만들 수 있어, 서로 다른 종류의 트래커·러너·코드 호스트가 함께
 * 등록된 경우도 시험할 수 있다. factory를 AdapterRegistry에 등록하면 만든 어댑터를
 * factory의 `created`에서 꺼내 응답을 정한다.
 */
import { AdapterError } from "../adapters.js";
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
  TrackerErrorDetail,
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

// ---------- Tracker ----------

type WebhookResult = { ok: true; event: TrackerEvent } | { ok: false; error: WebhookVerifyError };

export class FakeTracker implements Tracker {
  readonly kind: TrackerKind;
  readonly tickets = new Map<TicketKey, TrackerTicket>();
  readonly comments = new Map<TicketKey, TrackerComment[]>();
  readonly projects: TrackerProject[] = [];
  readonly labels = new Map<TrackerProjectId, TrackerLabel[]>();
  readonly states = new Map<TrackerProjectId, TrackerState[]>();
  /** setState 호출 기록 */
  readonly stateChanges: Array<{ key: TicketKey; stateId: TrackerStateId }> = [];
  connection: ConnectionCheck<TrackerErrorDetail> = { ok: true };
  /** verifyWebhook이 돌려줄 값. 따로 정하지 않으면 malformed다. */
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

  checkConnection(): Promise<ConnectionCheck<TrackerErrorDetail>> {
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

// ---------- Runner ----------

/** 가짜 러너 안의 런 하나. 테스트가 질문·권한 대기·완료 보고·사라짐을 일으킨다. */
export interface FakeRunnerRun {
  input: StartRunInput;
  started: StartedRun;
  questions: AgentQuestion[];
  /** answerQuestion으로 받은 답. 같은 질문에 두 번 오면 둘 다 남는다 */
  answers: Array<{ questionId: QuestionId; answer: string }>;
  /** 아직 열린 권한 대기 */
  permissionWaits: PermissionWait[];
  /** denyPermission으로 받은 거절 */
  denials: Array<{ permissionId: PermissionRequestId; reason: string }>;
  report: CompletionReport | null;
  /** 보고 없이 사라졌으면 그 설명 */
  endedWithoutReport: string | null;
  agentStopped: boolean;
  agentClosed: boolean;
  log: string[];
}

/**
 * 러너 하나. 따로 정하지 않으면 Online이고 갖춰야 할 것을 모두 갖췄으며,
 * `setProjects`로 넣은 러너 쪽 프로젝트를 가진다고 답한다.
 * Offline이면 러너에 닿는 메서드가 unreachable AdapterError로 실패한다.
 *
 * 실제 러너처럼 질문 메일은 답한 뒤에도 남는다(Q82.5). 답했는지는 부르는 쪽이 DB로 거른다.
 * 같은 워크트리 이름으로 다시 시작하면 runner-error로 거절한다. 이미 시작했는지는 findStartedRun으로 본다.
 */
export class FakeRunner implements Runner {
  readonly kind: RunnerKind;
  /** 워크트리 이름으로 찾는 런 */
  readonly runs = new Map<string, FakeRunnerRun>();
  /** removeWorktree 호출 기록 */
  readonly removed: WorktreeRef[] = [];
  /** startRun 호출 기록(실패 포함) */
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
  /** 다음 startRun을 이 오류로 실패시킨다. 한 번 쓰면 비운다. */
  failNextStart: RunnerErrorDetail | null = null;
  /** 다음 startRun은 런을 시작하지만 응답을 잃는다(start-outcome-unknown). 한 번 쓰면 거짓이 된다. */
  loseNextStartResponse = false;
  private readonly mailboxes = new Set<MailboxRef>();
  private seq = 0;

  constructor(kind: RunnerKind = toRunnerKind("fake")) {
    this.kind = kind;
  }

  setProjects(projects: ReadonlyArray<RunnerProject>): void {
    this.projects = [...projects];
  }

  /** 우편함 터미널이 사라진 것처럼 만든다. 그 우편함을 쓰는 호출은 mailbox-missing으로 실패한다. */
  dropMailbox(mailbox: MailboxRef): void {
    this.mailboxes.delete(mailbox);
  }

  /** 워크트리로 런을 찾는다. 없으면 던진다. */
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

  /** 에이전트가 질문한다(Q82.3). 질문 ID를 돌려준다. */
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

  /** 에이전트가 권한 프롬프트에서 허용을 기다린다(Q82.4). 대기 ID를 돌려준다. */
  requestPermission(worktree: WorktreeRef, detail: string, at?: Date): PermissionRequestId {
    const id = toPermissionRequestId(`fake-permission-${this.next()}`);
    this.runAt(worktree).permissionWaits.push({ id, detail, requestedAt: at ?? new Date() });
    return id;
  }

  /** 사람이 러너 화면에서 권한을 허용한 것처럼 대기를 닫는다. */
  allowPermission(worktree: WorktreeRef, id: PermissionRequestId): void {
    const run = this.runAt(worktree);
    run.permissionWaits = run.permissionWaits.filter((p) => p.id !== id);
  }

  /** 에이전트가 완료 보고를 보낸다(Q82.2). 에이전트는 닫을 때까지 살아 있다. */
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

  /** 에이전트가 완료 보고 없이 사라진다(Q82.19). */
  vanish(worktree: WorktreeRef, detail = "agent terminal is gone"): void {
    this.runAt(worktree).endedWithoutReport = detail;
  }

  /** 사람이 러너에서 워크트리를 지운 것처럼 만든다. */
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
        // 실제 러너처럼 브랜치는 러너가 접두사를 붙여 정한다(Q82.6).
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

// ---------- CodeHost ----------

/**
 * PR은 저장소별로 넣는다. 브랜치·티켓 키 찾기는 넣은 PR에서 고른다.
 * 러너 쪽 프로젝트 ID "<prefix><저장소>"를 저장소로 읽는다(기본 prefix "fake:").
 */
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

  /** 같은 id의 PR이 있으면 바꾼다. 병합·닫힘 같은 이후 변화도 이것으로 정한다. */
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

  /** 실제 어댑터처럼 키를 낱말 경계로 찾고 `createdSince` 이후에 만든 PR만 돌려준다(research 0006 20절). */
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

// ---------- Factories ----------

/** 등록할 수 있는 가짜 factory. create로 만든 어댑터를 `created`에 순서대로 모은다. */
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
