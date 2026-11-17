/**
 * 테스트용 가짜 어댑터. 메모리 안에서 동작하고, 테스트가 응답을 정할 수 있다.
 * worker 시험(0006·0016)과 끝에서 끝까지 얇은 경로(0008)가 이것으로 돈다.
 */
import { AdapterError } from "../adapters.js";
import type {
  CodeHost,
  CodeHostErrorDetail,
  ConnectionCheck,
  Page,
  Paged,
  PullRequestSnapshot,
  RepoRef,
  RunProgress,
  Runner,
  RunnerConnection,
  RunnerErrorDetail,
  RunnerHealth,
  RunnerProject,
  StartRunInput,
  StartedRun,
  Tracker,
  TrackerComment,
  TrackerErrorDetail,
  TrackerEvent,
  TrackerProject,
  TrackerState,
  TrackerTicket,
  WebhookVerifyError,
} from "../adapters.js";
import { toWorktreeRef } from "../ids.js";
import type { TicketKey, WorktreeRef } from "../ids.js";

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
  readonly tickets = new Map<TicketKey, TrackerTicket>();
  readonly comments = new Map<TicketKey, TrackerComment[]>();
  readonly projects: TrackerProject[] = [];
  readonly states = new Map<string, TrackerState[]>();
  /** setState 호출 기록 */
  readonly stateChanges: Array<{ key: TicketKey; stateId: string }> = [];
  connection: ConnectionCheck<TrackerErrorDetail> = { ok: true };
  /** verifyWebhook이 돌려줄 값. 따로 정하지 않으면 malformed다. */
  verifyWebhookWith: (input: { rawBody: Uint8Array; now: Date }) => WebhookResult = () => ({
    ok: false,
    error: "malformed",
  });
  private commentSeq = 0;

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

  listProjectTickets(projectId: string, page?: Page): Promise<Paged<TrackerTicket>> {
    const all = [...this.tickets.values()].filter((ticket) => ticket.project?.id === projectId);
    return Promise.resolve(paginate(all, page));
  }

  listLabeledTickets(input: {
    labelName: string;
    updatedSince: Date;
  }): Promise<ReadonlyArray<TrackerTicket>> {
    return Promise.resolve(
      [...this.tickets.values()].filter(
        (ticket) =>
          ticket.labels.some((label) => label.name === input.labelName) &&
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

  listStates(teamId: string): Promise<ReadonlyArray<TrackerState>> {
    return Promise.resolve(this.states.get(teamId) ?? []);
  }

  setState(key: TicketKey, stateId: string): Promise<void> {
    const ticket = this.tickets.get(key);
    if (ticket === undefined) return Promise.reject(new AdapterError({ kind: "not-found" }));
    const state = [...this.states.values()].flat().find((s) => s.id === stateId);
    if (state !== undefined) this.tickets.set(key, { ...ticket, state });
    this.stateChanges.push({ key, stateId });
    return Promise.resolve();
  }

  addComment(key: TicketKey, body: string): Promise<{ id: string; url: string }> {
    const ticket = this.tickets.get(key);
    if (ticket === undefined) return Promise.reject(new AdapterError({ kind: "not-found" }));
    this.commentSeq += 1;
    const id = `comment-${this.commentSeq}`;
    const list = this.comments.get(key) ?? [];
    list.push({ id, body, createdAt: new Date(), author: null });
    this.comments.set(key, list);
    return Promise.resolve({ id, url: `${ticket.url}#${id}` });
  }
}

// ---------- Runner ----------

interface FakeRunnerHost {
  online: boolean;
  serviceInstalled: boolean | null;
  projects: RunnerProject[];
}

interface FakeWorktree {
  sshTarget: string;
  input: StartRunInput;
  progress: RunProgress;
  log: string[];
  agentStopped: boolean;
}

/**
 * 러너는 RunnerConnection.sshTarget으로 가른다. 따로 정하지 않은 러너는 Online이고
 * 상시 서비스가 설치돼 있으며, `setProjects`로 넣은 러너 쪽 프로젝트를 가진다고 답한다.
 * Offline 러너에 닿는 메서드는 ssh-failed AdapterError로 실패한다.
 */
export class FakeRunner implements Runner {
  readonly worktrees = new Map<WorktreeRef, FakeWorktree>();
  /** removeWorktree 호출 기록 */
  readonly removed: Array<{ worktree: WorktreeRef; force: boolean }> = [];
  private readonly hosts = new Map<string, FakeRunnerHost>();
  private worktreeSeq = 0;

  private host(sshTarget: string): FakeRunnerHost {
    let host = this.hosts.get(sshTarget);
    if (host === undefined) {
      host = { online: true, serviceInstalled: true, projects: [] };
      this.hosts.set(sshTarget, host);
    }
    return host;
  }

  setOnline(sshTarget: string, online: boolean): void {
    this.host(sshTarget).online = online;
  }

  setServiceInstalled(sshTarget: string, installed: boolean | null): void {
    this.host(sshTarget).serviceInstalled = installed;
  }

  setProjects(sshTarget: string, projects: ReadonlyArray<RunnerProject>): void {
    this.host(sshTarget).projects = [...projects];
  }

  /** 런의 진행을 테스트가 정한다(입력 기다림, 끝남, 사라짐 등). */
  setProgress(worktree: WorktreeRef, progress: RunProgress): void {
    if (progress.kind === "gone") {
      this.worktrees.delete(worktree);
      return;
    }
    const entry = this.mustGet(worktree);
    entry.progress = progress;
  }

  appendLog(worktree: WorktreeRef, ...lines: string[]): void {
    this.mustGet(worktree).log.push(...lines);
  }

  checkHealth(conn: RunnerConnection): Promise<RunnerHealth> {
    const host = this.host(conn.sshTarget);
    return Promise.resolve({
      online: host.online,
      orcaVersion: host.online ? "fake" : null,
      runtimeState: host.online ? "ready" : null,
      serviceInstalled: host.online ? host.serviceInstalled : null,
      checkedAt: new Date(),
      error: host.online ? null : sshFailed(),
    });
  }

  listProjects(conn: RunnerConnection): Promise<ReadonlyArray<RunnerProject>> {
    return this.reach(conn, (host) => host.projects);
  }

  startRun(conn: RunnerConnection, input: StartRunInput): Promise<StartedRun> {
    return this.reach(conn, (host) => {
      if (!host.projects.some((project) => project.id === input.project)) {
        throw new AdapterError<RunnerErrorDetail>({
          kind: "orca-error",
          code: "project_not_found",
          message: `unknown project ${input.project}`,
        });
      }
      this.worktreeSeq += 1;
      const operationId = input.retryOperationId ?? `op-${this.worktreeSeq}`;
      const worktree = toWorktreeRef(`fake-repo::/fake/${input.worktreeName}-${this.worktreeSeq}`);
      this.worktrees.set(worktree, {
        sshTarget: conn.sshTarget,
        input,
        progress: { kind: "running", agentStates: ["working"], lastOutputAt: null },
        log: [],
        agentStopped: false,
      });
      return {
        worktree,
        branch: input.branch,
        agentHandle: `term-${this.worktreeSeq}`,
        operationId,
        promptDelivered: true,
      };
    });
  }

  pollRun(conn: RunnerConnection, worktree: WorktreeRef): Promise<RunProgress> {
    return this.reach(conn, () => this.worktrees.get(worktree)?.progress ?? { kind: "gone" });
  }

  stopAgent(conn: RunnerConnection, worktree: WorktreeRef): Promise<void> {
    return this.reach(conn, () => {
      const entry = this.mustGet(worktree);
      entry.agentStopped = true;
      entry.progress = { kind: "finished", exitCode: null };
    });
  }

  readLogTail(
    conn: RunnerConnection,
    worktree: WorktreeRef,
    opts: { lines: number },
  ): Promise<ReadonlyArray<string>> {
    return this.reach(conn, () => this.mustGet(worktree).log.slice(-opts.lines));
  }

  worktreeExists(conn: RunnerConnection, worktree: WorktreeRef): Promise<boolean> {
    return this.reach(conn, () => this.worktrees.has(worktree));
  }

  removeWorktree(
    conn: RunnerConnection,
    worktree: WorktreeRef,
    opts: { force: boolean },
  ): Promise<void> {
    return this.reach(conn, () => {
      this.worktrees.delete(worktree);
      this.removed.push({ worktree, force: opts.force });
    });
  }

  private reach<T>(conn: RunnerConnection, fn: (host: FakeRunnerHost) => T): Promise<T> {
    const host = this.host(conn.sshTarget);
    if (!host.online) return Promise.reject(new AdapterError(sshFailed()));
    try {
      return Promise.resolve(fn(host));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private mustGet(worktree: WorktreeRef): FakeWorktree {
    const entry = this.worktrees.get(worktree);
    if (entry === undefined) {
      throw new AdapterError<RunnerErrorDetail>({
        kind: "orca-error",
        code: "selector_not_found",
        message: `unknown worktree ${worktree}`,
      });
    }
    return entry;
  }
}

function sshFailed(): RunnerErrorDetail {
  return { kind: "ssh-failed", exitCode: 255, stderr: "fake runner is offline" };
}

// ---------- CodeHost ----------

/** PR은 저장소별로 넣는다. 브랜치·티켓 키 찾기는 넣은 PR에서 고른다. */
export class FakeCodeHost implements CodeHost {
  connection: ConnectionCheck<CodeHostErrorDetail> = { ok: true };
  rateLimitValue = { limit: 5000, remaining: 5000, resetAt: new Date(0) };
  private readonly prs = new Map<string, PullRequestSnapshot[]>();

  /** 같은 번호의 PR이 있으면 바꾼다. 병합·닫힘 같은 이후 변화도 이것으로 정한다. */
  putPullRequest(repo: RepoRef, pr: PullRequestSnapshot): void {
    const list = (this.prs.get(repoKey(repo)) ?? []).filter((p) => p.number !== pr.number);
    list.push(pr);
    this.prs.set(repoKey(repo), list);
  }

  checkConnection(): Promise<ConnectionCheck<CodeHostErrorDetail>> {
    return Promise.resolve(this.connection);
  }

  findPullRequestsByBranch(
    repo: RepoRef,
    branch: string,
  ): Promise<ReadonlyArray<PullRequestSnapshot>> {
    return Promise.resolve(this.list(repo).filter((pr) => pr.headRefName === branch));
  }

  findPullRequestsByTicketKey(
    repo: RepoRef,
    ticketKey: TicketKey,
  ): Promise<ReadonlyArray<PullRequestSnapshot>> {
    return Promise.resolve(
      this.list(repo).filter((pr) => pr.title.includes(ticketKey) || pr.body.includes(ticketKey)),
    );
  }

  getPullRequest(repo: RepoRef, number: number): Promise<PullRequestSnapshot | null> {
    return Promise.resolve(this.list(repo).find((pr) => pr.number === number) ?? null);
  }

  rateLimit(): Promise<{ limit: number; remaining: number; resetAt: Date }> {
    return Promise.resolve(this.rateLimitValue);
  }

  private list(repo: RepoRef): ReadonlyArray<PullRequestSnapshot> {
    return this.prs.get(repoKey(repo)) ?? [];
  }
}

function repoKey(repo: RepoRef): string {
  return `${repo.owner}/${repo.name}`.toLowerCase();
}
