/**
 * 외부 시스템 어댑터 인터페이스. research 0002 「어댑터 인터페이스 초안」에서 출발해
 * 스펙 5절과 뒤 티켓이 쓰는 것을 더했다.
 *
 * 1단계 구현은 Linear·Orca·GitHub 하나씩이지만 인터페이스는 특정 제품에 묶지 않는다.
 * - 어댑터마다 종류(kind)가 있고, AdapterRegistry 한 곳에 종류별 factory로 등록한다.
 *   새 종류는 core를 고치지 않고 어댑터 패키지 하나와 등록 한 줄로 더한다.
 * - 외부 ID는 core가 뜻을 해석하지 않는 불투명한 branded 문자열이다(ids.ts).
 * - 제품마다 다른 설정(ssh 대상, 실행 파일 경로, API 키 등)은 factory가 받는 config에 두고,
 *   어댑터가 경계에서 스키마로 파싱한다. core 타입에는 넣지 않는다.
 * - 외부 열거값은 모르는 값이 와도 깨지지 않게 `(string & {})`로 열어 둔다
 *   (CODING_STANDARDS 「외부 열거값은 모르는 값이 와도 깨지지 않게 둔다」).
 *
 * 실제 열거값과 신호는 검증 티켓(0009~0012) 뒤 0037에서 맞춘다.
 */
import type {
  AgentId,
  CodeHostKind,
  CommentId,
  DeliveryId,
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
} from "./ids.js";

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

export interface Page {
  after?: string;
  first?: number;
}

export interface Paged<T> {
  items: ReadonlyArray<T>;
  nextCursor: string | null;
}

// ---------- Tracker ----------

/**
 * 트래커 상태의 분류. 상태 이름은 트래커·팀마다 다르므로 분류로 뜻을 본다.
 * core가 정한 중립 분류이고, 어댑터가 자기 트래커의 상태를 여기에 맞춰 넣는다.
 * 맞는 분류가 없으면 트래커 값을 그대로 넣어도 된다.
 */
export type TrackerStateCategory =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled"
  | (string & {});

export interface TrackerState {
  id: TrackerStateId;
  name: string;
  category: TrackerStateCategory;
}

export interface TrackerLabel {
  id: LabelId;
  name: string;
}

export interface TrackerTicket {
  key: TicketKey;
  title: string;
  /** markdown */
  body: string;
  url: string;
  labels: ReadonlyArray<TrackerLabel>;
  project: { id: TrackerProjectId; name: string } | null;
  state: TrackerState;
  updatedAt: Date;
}

export interface TrackerComment {
  id: CommentId;
  body: string;
  createdAt: Date;
  author: string | null;
}

export interface TrackerProject {
  id: TrackerProjectId;
  name: string;
  url: string;
}

/** 서명·타임스탬프 검증을 통과한 webhook 하나. 검증 실패는 이 타입이 되지 못한다. */
export interface TrackerEvent {
  /** 중복 제거 키(Linear는 Linear-Delivery) */
  deliveryId: DeliveryId;
  kind: "ticket.created" | "ticket.updated" | "ticket.removed" | "other";
  ticketKey: TicketKey | null;
  projectId: TrackerProjectId | null;
  /** 이벤트 시점의 티켓 라벨. 이벤트에 없으면 null */
  labelIds: ReadonlyArray<LabelId> | null;
  /** 바뀌기 전 값. 형태는 트래커마다 다르다 */
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

export interface Tracker {
  readonly kind: TrackerKind;

  /** 인증 정보가 맞고 트래커에 닿는지 확인한다(온보딩·Settings). */
  checkConnection(): Promise<ConnectionCheck<TrackerErrorDetail>>;

  verifyWebhook(input: {
    rawBody: Uint8Array;
    headers: Readonly<Record<string, string | undefined>>;
    now: Date;
  }): { ok: true; event: TrackerEvent } | { ok: false; error: WebhookVerifyError };

  getTicket(key: TicketKey): Promise<TrackerTicket | null>;
  /** 트래커 프로젝트의 티켓 목록(Tickets 화면). */
  listProjectTickets(projectId: TrackerProjectId, page?: Page): Promise<Paged<TrackerTicket>>;
  /** 폴링 보정용: 라벨이 붙은 티켓을 updatedSince 이후로 찾는다(ADR 0001). */
  listLabeledTickets(input: {
    labelId: LabelId;
    updatedSince: Date;
  }): Promise<ReadonlyArray<TrackerTicket>>;
  listComments(key: TicketKey, page?: Page): Promise<Paged<TrackerComment>>;
  listProjects(): Promise<ReadonlyArray<TrackerProject>>;
  listLabels(projectId: TrackerProjectId): Promise<ReadonlyArray<TrackerLabel>>;
  /** 그 트래커 프로젝트의 티켓이 가질 수 있는 상태("In Progress" 고르기). */
  listStates(projectId: TrackerProjectId): Promise<ReadonlyArray<TrackerState>>;

  setState(key: TicketKey, stateId: TrackerStateId): Promise<void>;
  addComment(key: TicketKey, body: string): Promise<{ id: CommentId; url: string }>;
}

// ---------- Runner ----------

export type RunnerErrorDetail =
  /** 러너에 닿지 못함(ssh 실패 등). 연결 끊김 시계의 근거다 */
  | { kind: "unreachable"; detail: string }
  /** 러너에 실행 도구가 없음(예: orca 실행 파일) */
  | { kind: "not-installed"; detail: string }
  /** 닿았지만 런을 돌릴 준비가 안 됨(예: Orca 런타임이 꺼짐) */
  | { kind: "not-ready"; detail: string }
  /** 러너 도구가 돌려준 오류. code는 도구의 값 그대로 */
  | { kind: "runner-error"; code: string; message: string }
  /** 시작 요청의 결과를 모름. retryToken으로 같은 시작을 다시 보낸다 */
  | { kind: "start-outcome-unknown"; retryToken: RetryToken }
  | { kind: "malformed-output"; raw: string };

/** 러너가 런을 돌리려면 갖춰야 하는 것 하나(예: Orca 상시 서비스). 온보딩이 안내한다. */
export interface RunnerPrerequisite {
  id: string;
  name: string;
  /** 확인하지 못했으면 null */
  satisfied: boolean | null;
  /** 갖추는 방법(설치 명령 등). 없으면 null */
  hint: string | null;
}

export interface RunnerHealth {
  /** 러너에 닿고 런을 돌릴 준비가 됨 */
  online: boolean;
  /** 러너 도구 버전. 모르면 null */
  version: string | null;
  prerequisites: ReadonlyArray<RunnerPrerequisite>;
  checkedAt: Date;
  error: RunnerErrorDetail | null;
}

export interface RunnerProject {
  id: RunnerProjectId;
  displayName: string;
  /** 런을 돌릴 수 있는 상태인지. 값은 러너 도구마다 다르다 */
  setupState: "ready" | "not-set-up" | "setting-up" | "error" | (string & {});
}

export interface StartRunInput {
  project: RunnerProjectId;
  worktreeName: string;
  /** 오케스트레이터가 정한 브랜치(Q40) */
  branch: string;
  baseBranch?: string;
  /** 러너 도구의 에이전트 ID. 예: "claude", "codex" */
  agent: AgentId;
  /** 티켓 내용만(GLOSSARY Agent) */
  prompt: string;
  /** 러너 도구가 티켓과 잇는 데 쓸 수 있다(예: Orca --linear-issue) */
  ticket?: { key: TicketKey; url: string };
  /** 응답을 잃었을 때 같은 시작을 다시 보내기 위한 값(StartedRun.retryToken) */
  retryToken?: RetryToken;
}

export interface StartedRun {
  worktree: WorktreeRef;
  branch: string;
  /** 다시 보내기에 쓸 값(Orca operationId). 러너 도구가 지원하지 않으면 null */
  retryToken: RetryToken | null;
  promptDelivered: boolean;
}

/** 러너에서 읽은 런의 실제 상태. core의 resolveRunProgress가 다음 상태나 에이전트 결과로 바꾼다. */
export type RunProgress =
  | { kind: "running"; lastOutputAt: Date | null }
  /** 사람만 답할 수 있는 프롬프트에 멈춤 */
  | { kind: "waiting-for-input"; detail: string }
  /** 에이전트 프로세스가 끝남. 종료 코드를 읽지 못했으면 null */
  | { kind: "finished"; exitCode: number | null }
  /** 워크트리가 없어짐 */
  | { kind: "gone" };

/** 등록한 러너 하나에 붙은 어댑터. 연결 설정은 만들 때 받는다(AdapterRegistry). */
export interface Runner {
  readonly kind: RunnerKind;

  checkHealth(): Promise<RunnerHealth>;
  listProjects(): Promise<ReadonlyArray<RunnerProject>>;
  startRun(input: StartRunInput): Promise<StartedRun>;
  pollRun(worktree: WorktreeRef): Promise<RunProgress>;
  /** 시간 초과 때 에이전트를 멈춘다. 워크트리와 브랜치는 남긴다. */
  stopAgent(worktree: WorktreeRef): Promise<void>;
  /** 에이전트 출력의 마지막 줄들. Run 상세와 종료 때 저장할 200줄(Q46)에 쓴다. */
  readLogTail(worktree: WorktreeRef, opts: { lines: number }): Promise<ReadonlyArray<string>>;
  /** 끝난 런의 워크트리가 아직 러너에 있는지(Q75). */
  worktreeExists(worktree: WorktreeRef): Promise<boolean>;
  /** 런 종료 뒤 정리. 브랜치는 지우지 않는다(PR이 쓴다). */
  removeWorktree(worktree: WorktreeRef, opts: { force: boolean }): Promise<void>;
}

// ---------- Code host ----------

/** CI 상태의 중립 분류. 어댑터가 자기 코드 호스트의 값을 여기에 맞춰 넣는다. */
export type CiState = "success" | "failure" | "pending" | "none" | (string & {});

export interface PullRequestSnapshot {
  id: PullRequestId;
  /** 화면에 보일 짧은 이름. 예: "#7" */
  displayId: string;
  url: string;
  title: string;
  body: string;
  state: "open" | "closed" | "merged" | (string & {});
  createdAt: Date;
  mergedAt: Date | null;
  /** 변경을 담은 브랜치 */
  headBranch: string;
  /** 변경을 담은 브랜치가 있는 저장소. 포크에서 온 PR을 거르는 데 쓴다. 저장소가 지워졌으면 null */
  sourceRepo: RepoRef | null;
  /** head 커밋. CI 상태를 볼 때 쓴다 */
  headCommit: string;
  /** 병합할 대상 브랜치 */
  baseBranch: string;
  /** PR 상태에는 쓰지 않는 화면 보조 정보다(research 0002 C.4). */
  ci: CiState;
}

export type CodeHostErrorDetail =
  | { kind: "unauthorized" }
  | { kind: "rate-limited"; resetAt: Date | null }
  | { kind: "not-found" }
  | { kind: "network"; cause: unknown };

export interface CodeHost {
  readonly kind: CodeHostKind;

  /** 인증 정보가 맞고 코드 호스트에 닿는지 확인한다(온보딩·Settings). */
  checkConnection(): Promise<ConnectionCheck<CodeHostErrorDetail>>;
  /** 러너 쪽 프로젝트가 가리키는 저장소. 이 코드 호스트의 저장소가 아니면 null */
  repoOf(project: RunnerProjectId): RepoRef | null;
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
  /** PR 하나를 다시 조회한다. 이후 PR 상태와 CI 상태 폴링에 쓴다. */
  getPullRequest(repo: RepoRef, id: PullRequestId): Promise<PullRequestSnapshot | null>;
  /** 남은 요청 예산. 개념이 없는 코드 호스트는 null */
  rateLimit(): Promise<{ limit: number; remaining: number; resetAt: Date } | null>;
}
