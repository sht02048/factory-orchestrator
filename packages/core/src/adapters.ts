/**
 * 외부 시스템 어댑터 인터페이스. research 0002 「어댑터 인터페이스 초안」에서 출발해
 * 스펙 5절과 뒤 티켓이 쓰는 것을 더했다. 구현은 어댑터 패키지(tracker-linear, runner-orca,
 * codehost-github)가 하고, 외부 입력은 그쪽 경계에서 스키마로 파싱해 이 타입으로 넘긴다.
 *
 * 외부 열거값은 모르는 값이 와도 깨지지 않게 `(string & {})`로 열어 둔다
 * (CODING_STANDARDS 「외부 열거값은 모르는 값이 와도 깨지지 않게 둔다」).
 * 실제 열거값과 신호는 검증 티켓(0009~0012) 뒤 0037에서 맞춘다.
 */
import type { RunnerProjectId, TicketKey, WorktreeRef } from "./ids.js";

// ---------- 공통 ----------

/** 어댑터 메서드가 실패할 때 던지는 오류. `detail`로 종류를 가른다. */
export class AdapterError<D extends { kind: string }> extends Error {
  readonly detail: D;

  constructor(detail: D, options?: { cause?: unknown }) {
    super(`adapter error: ${detail.kind}`, options);
    this.name = "AdapterError";
    this.detail = detail;
  }
}

/** 연결 확인 결과. 온보딩·Settings가 보인다. */
export type ConnectionCheck<E> = { ok: true } | { ok: false; error: E };

// ---------- Tracker (Linear) ----------

export type TrackerStateType =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled"
  | "duplicate"
  | (string & {});

export interface TrackerState {
  id: string;
  name: string;
  type: TrackerStateType;
}

export interface TrackerTicket {
  key: TicketKey;
  /** Linear issue UUID */
  trackerId: string;
  title: string;
  /** markdown */
  body: string;
  url: string;
  labels: ReadonlyArray<{ id: string; name: string }>;
  project: { id: string; name: string } | null;
  team: { id: string; key: string };
  state: TrackerState;
  suggestedBranchName: string | null;
  updatedAt: Date;
}

export interface TrackerComment {
  id: string;
  body: string;
  createdAt: Date;
  author: string | null;
}

export interface TrackerProject {
  id: string;
  name: string;
  url: string;
  teamIds: ReadonlyArray<string>;
}

/** 서명·타임스탬프 검증을 통과한 webhook 하나. 검증 실패는 이 타입이 되지 못한다. */
export interface TrackerEvent {
  /** Linear-Delivery, 중복 제거 키 */
  deliveryId: string;
  kind: "ticket.created" | "ticket.updated" | "ticket.removed" | "other";
  ticketKey: TicketKey | null;
  /** 티켓이 속한 트래커 프로젝트 */
  projectId: string | null;
  /** data.labelIds */
  labelIds: ReadonlyArray<string> | null;
  /** updatedFrom */
  previous: Readonly<Record<string, unknown>> | null;
  receivedAt: Date;
}

export type WebhookVerifyError =
  | "bad-signature"
  | "stale-timestamp"
  | "body-too-large"
  | "malformed";

export type TrackerErrorDetail =
  | { kind: "unauthorized" }
  | { kind: "rate-limited"; retryAfterSeconds: number | null }
  | { kind: "not-found" }
  | { kind: "network"; cause: unknown };

export interface Page {
  after?: string;
  first?: number;
}

export interface Paged<T> {
  items: ReadonlyArray<T>;
  nextCursor: string | null;
}

export interface Tracker {
  /** API 키가 맞고 트래커에 닿는지 확인한다(온보딩·Settings). */
  checkConnection(): Promise<ConnectionCheck<TrackerErrorDetail>>;

  verifyWebhook(input: {
    rawBody: Uint8Array;
    headers: Readonly<Record<string, string | undefined>>;
    now: Date;
  }): { ok: true; event: TrackerEvent } | { ok: false; error: WebhookVerifyError };

  getTicket(key: TicketKey): Promise<TrackerTicket | null>;
  /** 트래커 프로젝트의 티켓 목록(Tickets 화면). */
  listProjectTickets(projectId: string, page?: Page): Promise<Paged<TrackerTicket>>;
  /** 폴링 보정용: 라벨이 붙은 티켓을 updatedSince 이후로 찾는다(ADR 0001). */
  listLabeledTickets(input: {
    labelName: string;
    updatedSince: Date;
  }): Promise<ReadonlyArray<TrackerTicket>>;
  listComments(key: TicketKey, page?: Page): Promise<Paged<TrackerComment>>;
  listProjects(): Promise<ReadonlyArray<TrackerProject>>;
  listStates(teamId: string): Promise<ReadonlyArray<TrackerState>>;

  setState(key: TicketKey, stateId: string): Promise<void>;
  addComment(key: TicketKey, body: string): Promise<{ id: string; url: string }>;
}

// ---------- Runner (Orca over ssh) ----------

export interface RunnerConnection {
  /** ssh config의 Host 이름 등, 운영자 설정 값 */
  sshTarget: string;
  /** 원격 orca 실행 파일 절대 경로(research 0002 A.8) */
  orcaPath: string;
}

export type RunnerErrorDetail =
  | { kind: "ssh-failed"; exitCode: number | null; stderr: string }
  | { kind: "orca-not-found" }
  | { kind: "runtime-unavailable"; detail: string }
  /** Orca `error.code` 그대로 */
  | { kind: "orca-error"; code: string; message: string }
  | { kind: "launch-outcome-unknown"; operationId: string }
  | { kind: "malformed-output"; raw: string };

export interface RunnerHealth {
  /** ssh 성공 + 런타임 ready */
  online: boolean;
  orcaVersion: string | null;
  runtimeState: "ready" | (string & {}) | null;
  /** Orca 상시 서비스(`orca serve service install --supervise`)가 설치됐는지. 확인하지 못했으면 null */
  serviceInstalled: boolean | null;
  checkedAt: Date;
  error: RunnerErrorDetail | null;
}

export interface RunnerProject {
  /** project setups[].projectId */
  id: RunnerProjectId;
  setupId: string;
  displayName: string;
  setupState: "ready" | "not-set-up" | "setting-up" | "error" | "unsupported" | (string & {});
}

export interface StartRunInput {
  project: RunnerProjectId;
  worktreeName: string;
  branch: string;
  baseBranch?: string;
  /** Orca agent id, 예: "claude", "codex" */
  agent: string;
  /** 티켓 내용만(GLOSSARY Agent) */
  prompt: string;
  /** --linear-issue */
  linearIssue?: string;
  /** 응답을 잃었을 때 같은 launch를 다시 보내기 위한 값(--retry-launch) */
  retryOperationId?: string;
}

export interface StartedRun {
  worktree: WorktreeRef;
  branch: string;
  agentHandle: string | null;
  /** --retry-launch에 쓸 Orca operationId */
  operationId: string | null;
  /** prompt.outcome이 journaled 또는 handed-to-terminal */
  promptDelivered: boolean;
}

/** 러너에서 읽은 런의 실제 상태. core의 resolveRunProgress가 다음 상태나 에이전트 결과로 바꾼다. */
export type RunProgress =
  | { kind: "running"; agentStates: ReadonlyArray<string>; lastOutputAt: Date | null }
  /** 사람만 답할 수 있는 프롬프트에 멈춤(--agent-wait) */
  | { kind: "waiting-for-input"; detail: string }
  /** 에이전트 프로세스가 끝남. 종료 코드를 읽지 못했으면 null */
  | { kind: "finished"; exitCode: number | null }
  /** 워크트리가 없어짐 */
  | { kind: "gone" };

export interface Runner {
  checkHealth(conn: RunnerConnection): Promise<RunnerHealth>;
  listProjects(conn: RunnerConnection): Promise<ReadonlyArray<RunnerProject>>;
  startRun(conn: RunnerConnection, input: StartRunInput): Promise<StartedRun>;
  pollRun(conn: RunnerConnection, worktree: WorktreeRef): Promise<RunProgress>;
  /** 시간 초과 때 에이전트를 멈춘다. 워크트리와 브랜치는 남긴다. */
  stopAgent(conn: RunnerConnection, worktree: WorktreeRef): Promise<void>;
  /** 에이전트 터미널의 마지막 줄들. Run 상세와 종료 때 저장할 200줄(Q46)에 쓴다. */
  readLogTail(
    conn: RunnerConnection,
    worktree: WorktreeRef,
    opts: { lines: number },
  ): Promise<ReadonlyArray<string>>;
  /** 끝난 런의 워크트리가 아직 러너에 있는지(Q75). */
  worktreeExists(conn: RunnerConnection, worktree: WorktreeRef): Promise<boolean>;
  /** 런 종료 뒤 정리. 브랜치는 지우지 않는다(PR이 쓴다). */
  removeWorktree(
    conn: RunnerConnection,
    worktree: WorktreeRef,
    opts: { force: boolean },
  ): Promise<void>;
}

// ---------- Code host (GitHub) ----------

export interface RepoRef {
  owner: string;
  name: string;
}

export type CiState =
  | "success"
  | "failure"
  | "pending"
  | "error"
  | "expected"
  | "none"
  | (string & {});

export interface PullRequestSnapshot {
  number: number;
  url: string;
  title: string;
  body: string;
  state: "open" | "closed" | "merged" | (string & {});
  createdAt: Date;
  mergedAt: Date | null;
  headRefName: string;
  /** 포크에서 온 PR을 거르는 데 쓴다(research 0002 C.2). 저장소가 지워졌으면 null */
  headRepository: RepoRef | null;
  isCrossRepository: boolean;
  headSha: string;
  baseRefName: string;
  /** statusCheckRollup.state, 없으면 "none". PR 상태에는 쓰지 않는다(research 0002 C.4). */
  ci: CiState;
}

export type CodeHostErrorDetail =
  | { kind: "unauthorized" }
  | { kind: "rate-limited"; resetAt: Date | null }
  | { kind: "not-found" }
  | { kind: "network"; cause: unknown };

export interface CodeHost {
  /** 토큰이 맞고 코드 호스트에 닿는지 확인한다(온보딩·Settings). */
  checkConnection(): Promise<ConnectionCheck<CodeHostErrorDetail>>;
  /** 브랜치로 PR을 찾는다(Q40 1순위). */
  findPullRequestsByBranch(
    repo: RepoRef,
    branch: string,
  ): Promise<ReadonlyArray<PullRequestSnapshot>>;
  /** PR 제목·본문의 티켓 키로 PR을 찾는다(Q40 2순위). */
  findPullRequestsByTicketKey(
    repo: RepoRef,
    ticketKey: TicketKey,
  ): Promise<ReadonlyArray<PullRequestSnapshot>>;
  /** PR 번호로 조회한다. 이후 PR 상태와 CI 상태 폴링에 쓴다. */
  getPullRequest(repo: RepoRef, number: number): Promise<PullRequestSnapshot | null>;
  rateLimit(): Promise<{ limit: number; remaining: number; resetAt: Date }>;
}
