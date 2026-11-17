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
  CodeHost,
  CodeHostErrorDetail,
  ConnectionCheck,
  Page,
  Paged,
  PullRequestSnapshot,
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
  toCodeHostKind,
  toCommentId,
  toRepoRef,
  toRetryToken,
  toRunnerKind,
  toTrackerKind,
  toWorktreeRef,
} from "../ids.js";
import type {
  CodeHostKind,
  CommentId,
  LabelId,
  PullRequestId,
  RepoRef,
  RetryToken,
  RunnerKind,
  RunnerProjectId,
  TicketKey,
  TrackerKind,
  TrackerProjectId,
  TrackerStateId,
  WorktreeRef,
} from "../ids.js";
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

interface FakeWorktree {
  input: StartRunInput;
  progress: RunProgress;
  log: string[];
  agentStopped: boolean;
}

/**
 * 러너 하나. 따로 정하지 않으면 Online이고 갖춰야 할 것을 모두 갖췄으며,
 * `setProjects`로 넣은 러너 쪽 프로젝트를 가진다고 답한다.
 * Offline이면 러너에 닿는 메서드가 unreachable AdapterError로 실패한다.
 */
export class FakeRunner implements Runner {
  readonly kind: RunnerKind;
  readonly worktrees = new Map<WorktreeRef, FakeWorktree>();
  /** removeWorktree 호출 기록 */
  readonly removed: Array<{ worktree: WorktreeRef; force: boolean }> = [];
  online = true;
  prerequisites: RunnerPrerequisite[] = [
    { id: "fake-service", name: "fake service", satisfied: true, hint: null },
  ];
  projects: RunnerProject[] = [];
  private readonly started = new Map<RetryToken, StartedRun>();
  private worktreeSeq = 0;

  constructor(kind: RunnerKind = toRunnerKind("fake")) {
    this.kind = kind;
  }

  setProjects(projects: ReadonlyArray<RunnerProject>): void {
    this.projects = [...projects];
  }

  /** 런의 진행을 테스트가 정한다(입력 기다림, 끝남, 사라짐 등). */
  setProgress(worktree: WorktreeRef, progress: RunProgress): void {
    if (progress.kind === "gone") {
      this.worktrees.delete(worktree);
      return;
    }
    this.mustGet(worktree).progress = progress;
  }

  appendLog(worktree: WorktreeRef, ...lines: string[]): void {
    this.mustGet(worktree).log.push(...lines);
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

  startRun(input: StartRunInput): Promise<StartedRun> {
    return this.reach(() => {
      // 같은 retryToken으로 다시 보내면 실제 러너처럼 같은 시작을 돌려준다.
      const retried =
        input.retryToken === undefined ? undefined : this.started.get(input.retryToken);
      if (retried !== undefined) return retried;

      if (!this.projects.some((project) => project.id === input.project)) {
        throw new AdapterError<RunnerErrorDetail>({
          kind: "runner-error",
          code: "project_not_found",
          message: `unknown project ${input.project}`,
        });
      }
      this.worktreeSeq += 1;
      const retryToken = input.retryToken ?? toRetryToken(`op-${this.worktreeSeq}`);
      const worktree = toWorktreeRef(`fake::/fake/${input.worktreeName}-${this.worktreeSeq}`);
      this.worktrees.set(worktree, {
        input,
        progress: { kind: "running", lastOutputAt: null },
        log: [],
        agentStopped: false,
      });
      const started: StartedRun = {
        worktree,
        branch: input.branch,
        retryToken,
        promptDelivered: true,
      };
      this.started.set(retryToken, started);
      return started;
    });
  }

  pollRun(worktree: WorktreeRef): Promise<RunProgress> {
    return this.reach(() => this.worktrees.get(worktree)?.progress ?? { kind: "gone" });
  }

  stopAgent(worktree: WorktreeRef): Promise<void> {
    return this.reach(() => {
      const entry = this.mustGet(worktree);
      entry.agentStopped = true;
      entry.progress = { kind: "finished", exitCode: null };
    });
  }

  readLogTail(worktree: WorktreeRef, opts: { lines: number }): Promise<ReadonlyArray<string>> {
    return this.reach(() => {
      const log = this.mustGet(worktree).log;
      return opts.lines <= 0 ? [] : log.slice(-opts.lines);
    });
  }

  worktreeExists(worktree: WorktreeRef): Promise<boolean> {
    return this.reach(() => this.worktrees.has(worktree));
  }

  removeWorktree(worktree: WorktreeRef, opts: { force: boolean }): Promise<void> {
    return this.reach(() => {
      this.worktrees.delete(worktree);
      this.removed.push({ worktree, force: opts.force });
    });
  }

  private reach<T>(fn: () => T): Promise<T> {
    if (!this.online) return Promise.reject(new AdapterError(unreachable()));
    try {
      return Promise.resolve(fn());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private mustGet(worktree: WorktreeRef): FakeWorktree {
    const entry = this.worktrees.get(worktree);
    if (entry === undefined) {
      throw new AdapterError<RunnerErrorDetail>({
        kind: "runner-error",
        code: "worktree_not_found",
        message: `unknown worktree ${worktree}`,
      });
    }
    return entry;
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

  findPullRequestsByTicketKey(
    repo: RepoRef,
    ticketKey: TicketKey,
  ): Promise<ReadonlyArray<PullRequestSnapshot>> {
    return Promise.resolve(
      this.list(repo).filter((pr) => pr.title.includes(ticketKey) || pr.body.includes(ticketKey)),
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
