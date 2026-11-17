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
 * 0037에서 검증 결과(research 0003~0006)와 런 실행 방식 결정(ADR 0009, research 0008 「제안: Runner
 * 어댑터 계약」, Q82.1~Q82.22)에 맞췄다. 서비스 이름(Orca의 Task·Dispatch·worker_done, Linear의
 * updatedFrom 등)은 들이지 않고 불투명한 ID와 core 낱말(완료 보고, 질문, 우편함 터미널)로 둔다.
 */
import type {
  AgentId,
  AgentRef,
  CodeHostKind,
  CommentId,
  DeliveryId,
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

/**
 * 서명·타임스탬프 검증을 통과한 webhook 하나. 검증 실패는 이 타입이 되지 못한다.
 *
 * 분류(research 0005 10·11절): 티켓을 가리키는 이벤트만 ticket.*로 둔다. 라벨 자체의 이벤트처럼
 * 티켓을 가리키지 않는 것은 other이고 할당 판단에 쓰지 않는다. 트래커가 보관과 삭제를 가르지 못하면
 * 둘 다 ticket.removed다(더 이상 할당 대상이 아님).
 */
export interface TrackerEvent {
  /** 중복 제거 키(Linear는 Linear-Delivery) */
  deliveryId: DeliveryId;
  kind: "ticket.created" | "ticket.updated" | "ticket.removed" | "other";
  ticketKey: TicketKey | null;
  projectId: TrackerProjectId | null;
  /** 이벤트 시점의 티켓 라벨. 이벤트에 없으면 null */
  labelIds: ReadonlyArray<LabelId> | null;
  /**
   * 이 이벤트로 라벨이 바뀌었으면 바뀌기 전 라벨 전부, 라벨이 바뀌지 않았으면 null이다.
   * 라벨이 "방금 붙었다"는 labelIds에 있고 이 값에 없는 것으로 안다(labelJustAttached).
   */
  previousLabelIds: ReadonlyArray<LabelId> | null;
  receivedAt: Date;
}

/**
 * webhook 이벤트로 라벨이 방금 붙었는지(research 0005 「설계에 주는 뜻」). 라벨이 바뀌지 않은
 * 이벤트(제목만 바뀜 등)에서는 라벨이 남아 있어도 거짓이라, 같은 티켓을 거듭 할당하지 않는다.
 */
export function labelJustAttached(
  event: Pick<TrackerEvent, "labelIds" | "previousLabelIds">,
  labelId: LabelId,
): boolean {
  return (
    event.labelIds !== null &&
    event.previousLabelIds !== null &&
    event.labelIds.includes(labelId) &&
    !event.previousLabelIds.includes(labelId)
  );
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
  /** 트래커 프로젝트의 티켓 목록(Tickets 화면). `first` 상한은 트래커가 정한다(Linear 250, research 0005). */
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
  /**
   * 러너에 닿지 못함(ssh 실패 등). 연결 끊김 시계와 시작 실패 판단(Q86)의 근거다. startRun이 이것을 던지면
   * 시작 명령이 러너에서 돌지 않았다는 뜻이다. 돌았는지 모르면 start-outcome-unknown을 던진다.
   */
  | { kind: "unreachable"; detail: string }
  /** 러너에 실행 도구가 없음(예: orca 실행 파일) */
  | { kind: "not-installed"; detail: string }
  /** 닿았지만 런을 돌릴 준비가 안 됨(예: Orca 런타임이 꺼짐, research 0003 1절) */
  | { kind: "not-ready"; detail: string }
  /** 우편함 터미널이 사라짐. ensureMailbox로 다시 만든 뒤 다시 부른다(Q82.1) */
  | { kind: "mailbox-missing"; detail: string }
  /** 러너 도구가 돌려준 오류. code는 도구의 값 그대로. startRun에서는 시작한 런이 남지 않았다는 뜻이다 */
  | { kind: "runner-error"; code: string; message: string }
  /**
   * 시작 요청의 결과를 모름(응답을 잃음 등). 같은 워크트리 이름으로 findStartedRun을 불러 이미 시작했는지
   * 확인한 뒤에만 다시 보낸다.
   */
  | { kind: "start-outcome-unknown"; detail: string }
  | { kind: "malformed-output"; raw: string };

/** 러너가 런을 돌리려면 갖춰야 하는 것 하나(예: Orca 상시 서비스). 온보딩이 안내한다. */
export interface RunnerPrerequisite {
  id: string;
  name: string;
  /** 확인하지 못했으면 null */
  satisfied: boolean | null;
  /** 갖추는 방법(설치 명령 등). 없으면 null */
  hint: string | null;
  /**
   * 갖추지 못했으면(satisfied가 false) 러너를 할당에서 빼는지. Online/Offline은 바꾸지 않는다.
   * 1단계에서는 러너의 GitHub 인증(비대화형 ssh 세션에서 각 프로젝트 저장소에 push할 수 있음)이다
   * (Q82.14·Q82.15). 상시 서비스처럼 없으면 Offline이 되는 것은 거짓이다.
   */
  blocksAssignment: boolean;
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

/**
 * 러너 확인 결과로 그 러너를 할당에서 빼야 하는지(Q82.14). 확인하지 못한 항목(satisfied null)은
 * 깨졌다는 증거가 없으니 빼지 않는다. 결과는 RunnerSnapshot.assignmentBlocked로 저장해 쓴다.
 */
export function isAssignmentBlocked(health: Pick<RunnerHealth, "prerequisites">): boolean {
  return health.prerequisites.some((p) => p.blocksAssignment && p.satisfied === false);
}

export interface RunnerProject {
  id: RunnerProjectId;
  displayName: string;
  /** 런을 돌릴 수 있는 상태인지. 값은 러너 도구마다 다르다 */
  setupState: "ready" | "not-set-up" | "setting-up" | "error" | (string & {});
}

export interface StartRunInput {
  /** 이 러너의 우편함(ensureMailbox). 에이전트의 질문과 완료 보고가 여기로 온다 */
  mailbox: MailboxRef;
  project: RunnerProjectId;
  /**
   * 오케스트레이터가 정한 결정적 워크트리 이름(Run.worktreeName). 시작 멱등 키다. 같은 이름으로 이미
   * 시작한 런이 있으면 새로 시작하지 않는다(findStartedRun).
   */
  worktreeName: string;
  baseBranch?: string;
  /** 러너 도구의 에이전트 ID. 예: "claude", "codex" */
  agent: AgentId;
  /** 에이전트에게 주는 지시. 티켓 내용만이다(GLOSSARY Agent) */
  prompt: string;
  /** 러너 도구가 티켓과 잇는 데 쓸 수 있다 */
  ticket?: { key: TicketKey; url: string };
}

export interface StartedRun {
  worktree: WorktreeRef;
  /** 러너가 정한 실제 브랜치 이름. 런 레코드에 저장하고 PR 찾기 1순위로 쓴다(Q82.6) */
  branch: string;
  /** 러너 안에서 이 런의 에이전트를 가리키는 값. 진행 폴링·답하기·멈추기에 넘긴다 */
  agentRef: AgentRef;
}

/** 진행 폴링·답하기·멈추기가 받는 런 하나 */
export interface RunOnRunner {
  mailbox: MailboxRef;
  worktree: WorktreeRef;
  agentRef: AgentRef;
}

/**
 * 에이전트가 운영자에게 보낸 질문(Q82.3). 러너는 메일을 소비하지 않고 읽으므로(Q82.5) 답한 뒤에도
 * 같은 질문이 다시 온다. 답했는지는 오케스트레이터 DB가 기준이다(resolveRunProgress).
 */
export interface AgentQuestion {
  id: QuestionId;
  body: string;
  /** 에이전트가 준 선택지. 없으면 빈 배열이고 운영자는 자유롭게 답한다 */
  options: ReadonlyArray<string>;
  askedAt: Date;
}

/**
 * 에이전트가 권한 프롬프트에서 허용을 기다림(Q82.4). 오케스트레이터는 거절만 할 수 있고 허용은 사람이
 * 러너 화면에서 한다. 러너 어댑터는 아직 열려 있는 대기만 돌려준다.
 */
export interface PermissionWait {
  id: PermissionRequestId;
  /** 무엇을 허용하려는지. 화면에 그대로 보인다 */
  detail: string;
  requestedAt: Date;
}

/**
 * 에이전트의 완료 보고(GLOSSARY 완료 보고). outcome이 에이전트 결과를 정한다(Q82.2).
 * 모르는 outcome은 성공이라는 증거가 없으니 실패로 다룬다(resolveRunProgress).
 */
export interface CompletionReport {
  outcome: "succeeded" | "failed" | (string & {});
  /** 보고 본문. Run 상세에 보인다 */
  body: string;
  /** 러너가 알려 준 보고 시각. 모르면 null */
  reportedAt: Date | null;
}

/**
 * 러너에서 읽은 런의 실제 상태(research 0008 「pollRun 판정 순서」). 러너 어댑터가 아래 순서로 하나를
 * 고른다: 완료 보고 → 보고 없이 사라짐 → 워크트리 사라짐 → 그 밖(돌고 있음). core의 resolveRunProgress가
 * 다음 상태나 에이전트 결과로 바꾼다.
 */
export type RunProgress =
  /**
   * 에이전트가 살아 있다. 받은 질문 전부(답한 것 포함)와 열린 권한 대기를 함께 준다. 둘 다 비었거나
   * 모두 처리했으면 Running이고, 아니면 Waiting for Input이다.
   */
  | {
      kind: "active";
      questions: ReadonlyArray<AgentQuestion>;
      permissionWaits: ReadonlyArray<PermissionWait>;
    }
  /** 완료 보고를 받았다. 대화형 에이전트는 보고 뒤에도 살아 있어 closeAgent로 닫는다(Q82.19) */
  | { kind: "reported"; report: CompletionReport }
  /**
   * 에이전트가 완료 보고 없이 사라졌다(Q82.19). 러너가 사라졌다고 알렸거나, 에이전트 터미널이 사라졌거나,
   * 셸만 남고 에이전트가 러너의 워크트리 목록에서 사라졌다.
   */
  | { kind: "ended-without-report"; detail: string }
  /** 워크트리가 없어짐(Q49·Q67) */
  | { kind: "worktree-gone" };

/** 등록한 러너 하나에 붙은 어댑터. 연결 설정은 만들 때 받는다(AdapterRegistry). */
export interface Runner {
  readonly kind: RunnerKind;

  checkHealth(): Promise<RunnerHealth>;
  listProjects(): Promise<ReadonlyArray<RunnerProject>>;

  /**
   * 우편함 터미널과 그 메일함을 확인하고, 없거나 사라졌으면 만든다(Q82.1·Q82.7). 지금 저장한 값을 주면
   * 살아 있을 때 그대로 돌려주고, 새로 만들었으면 다른 값을 돌려준다. 돌려준 값을 러너에 저장한다.
   */
  ensureMailbox(current: MailboxRef | null): Promise<MailboxRef>;

  /**
   * 워크트리를 만들고 에이전트를 대화형으로 띄운다(ADR 0009). 결과를 모르면 start-outcome-unknown을
   * 던진다. 그 뒤에는 findStartedRun으로 확인하기 전에 다시 부르지 않는다.
   */
  startRun(input: StartRunInput): Promise<StartedRun>;
  /**
   * 시작 멱등: 같은 결정적 워크트리 이름으로 이미 시작한 런을 찾는다. 없으면 null이다.
   * 데몬이 러너의 응답을 받은 뒤 Running을 쓰기 전에 죽었을 때 이어 붙이는 데 쓴다.
   */
  findStartedRun(input: { mailbox: MailboxRef; worktreeName: string }): Promise<StartedRun | null>;

  pollRun(run: RunOnRunner): Promise<RunProgress>;
  /** 에이전트 질문에 답한다(Q82.3). 같은 질문에 두 번 보내지 않는 것은 부르는 쪽(DB)이 지킨다 */
  answerQuestion(
    run: RunOnRunner,
    input: { questionId: QuestionId; answer: string },
  ): Promise<void>;
  /** 권한 대기를 거절한다(Q82.4). 허용은 없다 */
  denyPermission(
    run: RunOnRunner,
    input: { permissionId: PermissionRequestId; reason: string },
  ): Promise<void>;

  /** 시간 초과·취소 때 끝나지 않은 에이전트를 멈춘다. 워크트리와 브랜치는 남긴다(research 0003 19절). */
  stopAgent(run: RunOnRunner): Promise<void>;
  /** 완료 보고를 받은 뒤 에이전트를 닫는다(Q82.2·Q82.19). 워크트리와 브랜치는 남긴다. */
  closeAgent(run: RunOnRunner): Promise<void>;
  /** 에이전트 출력의 마지막 줄들. Run 상세와 종료 때 저장할 200줄(Q46)에 쓴다. 멈추거나 닫기 전에 읽는다. */
  readLogTail(run: RunOnRunner, opts: { lines: number }): Promise<ReadonlyArray<string>>;
  /** 끝난 런의 워크트리가 아직 러너에 있는지(Q75). */
  worktreeExists(worktree: WorktreeRef): Promise<boolean>;
  /**
   * 런 종료 뒤 워크트리를 지운다. 에이전트가 남긴 파일이 있어도 지운다(research 0003 9절).
   * 브랜치는 지우지 않는다(PR이 쓴다).
   */
  removeWorktree(worktree: WorktreeRef): Promise<void>;
}

// ---------- Code host ----------

/**
 * CI 상태의 중립 분류. 어댑터가 자기 코드 호스트의 값을 여기에 맞춰 넣는다. CI 상태는 선택 표시이고
 * 요약 결과에 쓰지 않는다(Q79).
 * - none: CI가 없음
 * - unavailable: 토큰에 CI를 읽을 권한이 없어 볼 수 없음("CI 상태를 볼 수 없어요"). none과 구분한다
 */
export type CiState = "success" | "failure" | "pending" | "none" | "unavailable" | (string & {});

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
  /**
   * PR 제목·본문의 티켓 키로 PR을 찾는다(Q40 2순위). `createdSince` 이후에 만든 PR만 돌려준다.
   * 어댑터는 키를 낱말 경계로 다시 걸러 다른 키(ENG-1234 등)가 걸리지 않게 한다(research 0006 20절).
   */
  findPullRequestsByTicketKey(
    repo: RepoRef,
    ticketKey: TicketKey,
    opts: { createdSince: Date },
  ): Promise<ReadonlyArray<PullRequestSnapshot>>;
  /** PR 하나를 다시 조회한다. 이후 PR 상태와 CI 상태 폴링에 쓴다. */
  getPullRequest(repo: RepoRef, id: PullRequestId): Promise<PullRequestSnapshot | null>;
  /** 남은 요청 예산. 개념이 없는 코드 호스트는 null */
  rateLimit(): Promise<{ limit: number; remaining: number; resetAt: Date } | null>;
}
