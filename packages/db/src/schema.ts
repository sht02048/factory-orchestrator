/**
 * 1단계 스키마(Drizzle). 마이그레이션 SQL은 drizzle-kit이 이 파일에서 만든다(`pnpm --filter @factory/db db:generate`).
 *
 * 확장 원칙: core 타입(Run 상태, 두 축, 이후 PR 상태, 어댑터 종류 + 불투명한 외부 ID)만 컬럼으로 두고,
 * 특정 서비스(Linear, Orca, GitHub)에만 있는 값은 어댑터 설정 JSON(`config`)과 봉한 비밀값
 * (`secrets`)에 둔다. 새 어댑터 종류를 더해도 스키마를 바꾸지 않는다.
 *
 * ID 컬럼은 `$type`으로 core branded type을 붙이고, 상태 컬럼은 core 열거를 `enum`으로 준다.
 * 추론 타입이 core 타입과 맞는지는 schema-types.ts가 컴파일 타임에 확인한다.
 * 시각은 모두 Unix epoch 밀리초 INTEGER(`timestamp_ms`)다.
 * 요약 결과, Failed 사유, 워크트리 처리는 저장하지 않는다. core 요약 계산 함수로 계산한다(Q66·Q71).
 */
import { AGENT_RESULTS, NOT_STARTED_AGENT_RESULTS, PR_STATES, RUN_STATES } from "@factory/core";
import type {
  AgentId,
  AgentRef,
  CodeHostKind,
  CommentId,
  DeliveryId,
  LabelId,
  MailboxRef,
  PullRequestId,
  PermissionRequestId,
  QuestionId,
  RunId,
  RunnerId,
  RunnerKind,
  RunnerProjectId,
  TicketKey,
  TrackerConnectionId,
  TrackerKind,
  TrackerProjectId,
  TrackerStateId,
  WorktreeRef,
} from "@factory/core";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { CodeHostConnectionId, WorkspaceId } from "./ids.js";

const timeMs = (name: string) => integer(name, { mode: "timestamp_ms" });
const jsonConfig = () => text("config").notNull().default("{}");

/** CHECK 제약에 넣는 상수 목록. 값은 core 상수라 그대로 SQL에 옮긴다(DDL에는 바인딩 인자를 쓸 수 없다). */
const inList = (values: ReadonlyArray<string>) =>
  sql.raw(`(${values.map((v) => `'${v.replaceAll("'", "''")}'`).join(", ")})`);

/** 이후 PR 상태: 런이 끝난 뒤 사람이 병합하거나 닫은 것(Q54·Q69) */
export const LATER_PR_STATES = ["merged", "closed"] as const;

// ---------- 설치 단위 연결 ----------

/** Tracker Connection(ADR 0006). API 키, webhook signing secret은 secrets에 봉해 둔다. */
export const trackerConnections = sqliteTable(
  "tracker_connections",
  {
    id: text("id").primaryKey().$type<TrackerConnectionId>(),
    kind: text("kind").notNull().$type<TrackerKind>(),
    name: text("name").notNull(),
    config: jsonConfig(),
    secrets: text("secrets").notNull(),
    createdAt: timeMs("created_at").notNull(),
  },
  (t) => [check("tracker_connections_config_json", sql`json_valid(${t.config})`)],
);

/** 코드 호스트 연결(GitHub 토큰). 토큰은 secrets에 봉해 둔다. */
export const codeHostConnections = sqliteTable(
  "code_host_connections",
  {
    id: text("id").primaryKey().$type<CodeHostConnectionId>(),
    kind: text("kind").notNull().$type<CodeHostKind>(),
    name: text("name").notNull(),
    config: jsonConfig(),
    secrets: text("secrets").notNull(),
    createdAt: timeMs("created_at").notNull(),
  },
  (t) => [check("code_host_connections_config_json", sql`json_valid(${t.config})`)],
);

// ---------- 러너 ----------

/** Runner(ADR 0006). ssh 대상, orca 경로 같은 어댑터 값은 config에 둔다. */
export const runners = sqliteTable(
  "runners",
  {
    id: text("id").primaryKey().$type<RunnerId>(),
    kind: text("kind").notNull().$type<RunnerKind>(),
    name: text("name").notNull(),
    config: jsonConfig(),
    capacity: integer("capacity").notNull(),
    online: integer("online", { mode: "boolean" }).notNull().default(false),
    /**
     * 러너 확인에서 할당을 막는 필수 조건이 깨졌는지(core isAssignmentBlocked). 1단계는 러너의 GitHub 인증이다
     * (Q82.14). 참이면 러너 고르기에서 빠지지만 online은 바꾸지 않는다.
     */
    assignmentBlocked: integer("assignment_blocked", { mode: "boolean" }).notNull().default(false),
    /**
     * 마지막으로 읽은 러너 필수 조건(core RunnerPrerequisite[] JSON). 1단계는 Orca 상시 서비스와 프로젝트별
     * GitHub 인증(`git push --dry-run`, Q82.15)이다. Runners 화면이 어느 프로젝트가 깨졌는지 보인다.
     * 아직 읽지 못했으면 NULL
     */
    prerequisites: text("prerequisites"),
    /** 러너 어댑터가 만든 우편함(core MailboxRef, Q82.1·Q82.7). 아직 만들지 않았으면 NULL */
    mailboxRef: text("mailbox_ref").$type<MailboxRef>(),
    /** 마지막 상태 확인 시각. 확인한 적 없으면 NULL */
    checkedAt: timeMs("checked_at"),
    /** 그때의 오류(RunnerErrorDetail JSON) */
    checkError: text("check_error"),
    createdAt: timeMs("created_at").notNull(),
  },
  (t) => [
    check("runners_config_json", sql`json_valid(${t.config})`),
    check("runners_capacity", sql`${t.capacity} >= 1`),
    check("runners_online", sql`${t.online} IN (0, 1)`),
    check("runners_assignment_blocked", sql`${t.assignmentBlocked} IN (0, 1)`),
    check("runners_check_error_json", sql`${t.checkError} IS NULL OR json_valid(${t.checkError})`),
    check(
      "runners_prerequisites_json",
      sql`${t.prerequisites} IS NULL OR json_valid(${t.prerequisites})`,
    ),
  ],
);

/** 러너가 가진 러너 쪽 프로젝트. worker의 러너 확인이 덮어쓴다(0016). */
export const runnerProjects = sqliteTable(
  "runner_projects",
  {
    runnerId: text("runner_id")
      .notNull()
      .references(() => runners.id, { onDelete: "cascade" })
      .$type<RunnerId>(),
    projectId: text("project_id").notNull().$type<RunnerProjectId>(),
    displayName: text("display_name").notNull(),
    setupState: text("setup_state").notNull(),
  },
  (t) => [primaryKey({ columns: [t.runnerId, t.projectId] })],
);

// ---------- Workspace ----------

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey().$type<WorkspaceId>(),
    name: text("name").notNull(),
    maxRunMs: integer("max_run_ms").notNull().default(7_200_000),
    createdAt: timeMs("created_at").notNull(),
  },
  (t) => [check("workspaces_max_run_ms", sql`${t.maxRunMs} > 0`)],
);

/**
 * Workspace의 트래커 프로젝트. 기본 키가 트래커 프로젝트라 한 Workspace에만 속한다(ADR 0006).
 * "In Progress" 상태는 트래커 상태가 트래커 프로젝트(팀)마다 달라 여기 둔다(Tracker.listStates).
 */
export const workspaceTrackerProjects = sqliteTable(
  "workspace_tracker_projects",
  {
    trackerConnectionId: text("tracker_connection_id")
      .notNull()
      .references(() => trackerConnections.id)
      .$type<TrackerConnectionId>(),
    trackerProjectId: text("tracker_project_id").notNull().$type<TrackerProjectId>(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" })
      .$type<WorkspaceId>(),
    name: text("name").notNull(),
    inProgressStateId: text("in_progress_state_id").$type<TrackerStateId>(),
  },
  (t) => [
    primaryKey({ columns: [t.trackerConnectionId, t.trackerProjectId] }),
    index("workspace_tracker_projects_workspace").on(t.workspaceId),
  ],
);

/** Mapping: 트래커 프로젝트 → 러너 쪽 프로젝트·에이전트. 러너는 고르지 않는다(Q53). */
export const mappings = sqliteTable(
  "mappings",
  {
    trackerConnectionId: text("tracker_connection_id").notNull().$type<TrackerConnectionId>(),
    trackerProjectId: text("tracker_project_id").notNull().$type<TrackerProjectId>(),
    runnerProjectId: text("runner_project_id").notNull().$type<RunnerProjectId>(),
    agentId: text("agent_id").notNull().$type<AgentId>(),
  },
  (t) => [
    primaryKey({ columns: [t.trackerConnectionId, t.trackerProjectId] }),
    foreignKey({
      columns: [t.trackerConnectionId, t.trackerProjectId],
      foreignColumns: [
        workspaceTrackerProjects.trackerConnectionId,
        workspaceTrackerProjects.trackerProjectId,
      ],
    }).onDelete("cascade"),
  ],
);

/** Auto-assign Label. 라벨은 트래커 연결마다 달라 Workspace × 트래커 연결마다 하나다. */
export const autoAssignLabels = sqliteTable(
  "auto_assign_labels",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" })
      .$type<WorkspaceId>(),
    trackerConnectionId: text("tracker_connection_id")
      .notNull()
      .references(() => trackerConnections.id)
      .$type<TrackerConnectionId>(),
    labelId: text("label_id").notNull().$type<LabelId>(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.trackerConnectionId] })],
);

// ---------- 런 ----------

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey().$type<RunId>(),
    trackerConnectionId: text("tracker_connection_id")
      .notNull()
      .references(() => trackerConnections.id)
      .$type<TrackerConnectionId>(),
    ticketKey: text("ticket_key").notNull().$type<TicketKey>(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id)
      .$type<WorkspaceId>(),
    /** 트래커 프로젝트는 외래 키로 묶지 않는다. Workspace에서 빼도 지난 런과 통계는 남는다. */
    trackerProjectId: text("tracker_project_id").notNull().$type<TrackerProjectId>(),
    runnerProjectId: text("runner_project_id").notNull().$type<RunnerProjectId>(),
    agentId: text("agent_id").notNull().$type<AgentId>(),
    /** 할당 때 정한 결정적 워크트리 이름. 시작 전에 쓰고 시작 멱등 키로 쓴다(core Run.worktreeName) */
    worktreeName: text("worktree_name").notNull(),
    /** 러너에서 받은 실제 브랜치(Q82.6). 시작한 런에만 있다 */
    branch: text("branch"),
    state: text("state", { enum: RUN_STATES }).notNull(),
    /** Queued에서는 비울 수 있다(맞는 러너가 모두 Offline, Q65·Q72) */
    runnerId: text("runner_id")
      .references(() => runners.id)
      .$type<RunnerId>(),
    /** 대기열 순서이기도 하다(Q73) */
    assignedAt: timeMs("assigned_at").notNull(),
    startedAt: timeMs("started_at"),
    endedAt: timeMs("ended_at"),
    worktreeRef: text("worktree_ref").$type<WorktreeRef>(),
    /** 러너 안에서 이 런의 에이전트를 가리키는 값(core AgentRef). 시작한 런에만 있다 */
    agentRef: text("agent_ref").$type<AgentRef>(),
    /**
     * 러너에 시작을 처음 보내기 직전에 쓴 시각. 있으면 이미 보냈을 수 있으니 다시 보내기 전에
     * 같은 워크트리 이름으로 이미 시작한 런을 찾는다(시작 멱등)
     */
    startRequestedAt: timeMs("start_requested_at"),
    /** 러너에 닿았는데 시작 명령이 오류를 낸 수(Q86). core decideStartFailure가 센다 */
    startFailures: integer("start_failures").notNull().default(0),
    /** 마지막 시작 오류. 시작할 수 없음으로 끝낸 런에는 그 오류가 남는다(Q86) */
    startError: text("start_error"),
    /** 두 축. Ended에서만 있고 그 뒤 바꾸지 않는다(ADR 0004, Q69) */
    agentResult: text("agent_result", { enum: AGENT_RESULTS }),
    prState: text("pr_state", { enum: PR_STATES }),
    /** 운영자가 취소함이 러너에 닿지 못한 채 끝났는지(Q82.21). 그 밖은 늘 거짓이다 */
    runnerUnreached: integer("runner_unreached", { mode: "boolean" }).notNull().default(false),
    /** 완료 보고 본문(Q82.2). 완료 보고로 끝난 런에만 있다 */
    reportBody: text("report_body"),
    /** 런과 이어진 PR과 그 CI 상태(worker가 폴링해 쓴다, 0017) */
    prId: text("pr_id").$type<PullRequestId>(),
    prDisplayId: text("pr_display_id"),
    prUrl: text("pr_url"),
    prCiState: text("pr_ci_state"),
    prCheckedAt: timeMs("pr_checked_at"),
    /** 이후 PR 상태(Q54·Q69) */
    laterPrState: text("later_pr_state", { enum: LATER_PR_STATES }),
    laterPrStateAt: timeMs("later_pr_state_at"),
    /** 워크트리를 지운 시각. worker가 지웠거나 사람이 지운 것을 확인한 때(Q75) */
    worktreeRemovedAt: timeMs("worktree_removed_at"),
    /** 트래커 갱신 기록. 재시작해도 두 번 하지 않는다(0017) */
    trackerStateSetAt: timeMs("tracker_state_set_at"),
    trackerCommentId: text("tracker_comment_id").$type<CommentId>(),
    trackerCommentedAt: timeMs("tracker_commented_at"),
    /** ssh 연속 실패가 시작된 시각. 한 번이라도 닿으면 NULL(Q50) */
    unreachableSince: timeMs("unreachable_since"),
    /** 런이 끝날 때 저장한 마지막 로그 200줄(Q46) */
    lastLog: text("last_log", { mode: "json" }).$type<string[]>(),
  },
  (t) => [
    check("runs_state", sql`${t.state} IN ${inList(RUN_STATES)}`),
    check("runs_agent_result", sql`${t.agentResult} IN ${inList(AGENT_RESULTS)}`),
    check("runs_pr_state", sql`${t.prState} IN ${inList(PR_STATES)}`),
    check("runs_later_pr_state", sql`${t.laterPrState} IN ${inList(LATER_PR_STATES)}`),
    check("runs_last_log_json", sql`${t.lastLog} IS NULL OR json_valid(${t.lastLog})`),
    check("runs_runner_unreached", sql`${t.runnerUnreached} IN (0, 1)`),
    // 시작한 런(Running·Waiting for Input·Disconnected, 시작한 뒤 끝난 런)에는 러너·워크트리·브랜치·
    // 에이전트 참조가 있다. Queued는 시작하지 않았다.
    check("runs_queued_not_started", sql`${t.state} <> 'queued' OR ${t.startedAt} IS NULL`),
    check(
      "runs_active_started",
      sql`${t.state} NOT IN ('running', 'waiting-for-input', 'disconnected') OR ${t.startedAt} IS NOT NULL`,
    ),
    check(
      "runs_started_has_runner_worktree",
      sql`${t.startedAt} IS NULL OR (${t.runnerId} IS NOT NULL AND ${t.worktreeRef} IS NOT NULL AND ${t.branch} IS NOT NULL AND ${t.agentRef} IS NOT NULL)`,
    ),
    // 시작하지 않고 끝난 런은 Queued에서 취소했거나 시작할 수 없음이고, PR 상태가 없음으로 고정된다(Q82.10·Q82.20).
    check(
      "runs_not_started_ended",
      sql`${t.state} <> 'ended' OR ${t.startedAt} IS NOT NULL OR (${t.agentResult} IN ${inList(NOT_STARTED_AGENT_RESULTS)} AND ${t.prState} = 'none' AND ${t.worktreeRef} IS NULL)`,
    ),
    check(
      "runs_could_not_start_not_started",
      sql`${t.agentResult} IS NULL OR ${t.agentResult} <> 'could-not-start' OR ${t.startedAt} IS NULL`,
    ),
    // 러너에 닿지 못한 채 끝났다는 기록은 시작한 뒤 취소한 런에만 붙는다(Q82.21).
    check(
      "runs_runner_unreached_canceled",
      sql`${t.runnerUnreached} = 0 OR (${t.agentResult} = 'canceled' AND ${t.startedAt} IS NOT NULL)`,
    ),
    check("runs_ended_at_iff_ended", sql`(${t.state} = 'ended') = (${t.endedAt} IS NOT NULL)`),
    check(
      "runs_agent_result_iff_ended",
      sql`(${t.state} = 'ended') = (${t.agentResult} IS NOT NULL)`,
    ),
    check("runs_pr_state_iff_ended", sql`(${t.state} = 'ended') = (${t.prState} IS NOT NULL)`),
    check("runs_later_pr_state_ended", sql`${t.laterPrState} IS NULL OR ${t.state} = 'ended'`),
    // 티켓당 Ended가 아닌 런은 하나다(Q45·Q74). web과 worker가 동시에 할당해도 DB가 막는다.
    uniqueIndex("runs_one_active_per_ticket")
      .on(t.trackerConnectionId, t.ticketKey)
      .where(sql`${t.state} <> 'ended'`),
    index("runs_ticket").on(t.trackerConnectionId, t.ticketKey, t.assignedAt),
    index("runs_state").on(t.state, t.assignedAt),
    index("runs_workspace").on(t.workspaceId, t.assignedAt),
  ],
);

/**
 * 런 상태 변경 이력. Waiting for Input·Disconnected에 들어가고 나온 시각을 담는다(Q52·Q67).
 * 할당은 fromState가 NULL인 행이다.
 */
export const runStateChanges = sqliteTable(
  "run_state_changes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" })
      .$type<RunId>(),
    fromState: text("from_state", { enum: RUN_STATES }),
    toState: text("to_state", { enum: RUN_STATES }).notNull(),
    changedAt: timeMs("changed_at").notNull(),
  },
  (t) => [index("run_state_changes_run").on(t.runId, t.id)],
);

// ---------- webhook 이벤트와 web 요청 ----------

/** 검증을 통과한 webhook 이벤트. 기본 키가 중복 제거 키(Linear-Delivery)다(research 0002 B.2). */
export const trackerEvents = sqliteTable(
  "tracker_events",
  {
    trackerConnectionId: text("tracker_connection_id")
      .notNull()
      .references(() => trackerConnections.id)
      .$type<TrackerConnectionId>(),
    deliveryId: text("delivery_id").notNull().$type<DeliveryId>(),
    /** core TrackerEvent의 kind. 외부 열거라 열어 둔다 */
    kind: text("kind").notNull(),
    trackerProjectId: text("tracker_project_id").$type<TrackerProjectId>(),
    ticketKey: text("ticket_key").$type<TicketKey>(),
    labelIds: text("label_ids", { mode: "json" }).$type<LabelId[]>(),
    /** 이 이벤트로 라벨이 바뀌었으면 바뀌기 전 라벨 전부(core TrackerEvent.previousLabelIds) */
    previousLabelIds: text("previous_label_ids", { mode: "json" }).$type<LabelId[]>(),
    receivedAt: timeMs("received_at").notNull(),
    processedAt: timeMs("processed_at"),
  },
  (t) => [
    primaryKey({ columns: [t.trackerConnectionId, t.deliveryId] }),
    check("tracker_events_label_ids_json", sql`${t.labelIds} IS NULL OR json_valid(${t.labelIds})`),
    check(
      "tracker_events_previous_label_ids_json",
      sql`${t.previousLabelIds} IS NULL OR json_valid(${t.previousLabelIds})`,
    ),
    index("tracker_events_unprocessed")
      .on(t.receivedAt)
      .where(sql`${t.processedAt} IS NULL`),
  ],
);

/** web이 남기는 로그 꼬리 요청과 결과. 런마다 하나이고 다음 요청이 덮어쓴다(Q46·Q61). */
export const logTailRequests = sqliteTable(
  "log_tail_requests",
  {
    runId: text("run_id")
      .primaryKey()
      .references(() => runs.id, { onDelete: "cascade" })
      .$type<RunId>(),
    requestedAt: timeMs("requested_at").notNull(),
    completedAt: timeMs("completed_at"),
    lines: text("lines", { mode: "json" }).$type<string[]>(),
    error: text("error"),
  },
  (t) => [check("log_tail_requests_lines_json", sql`${t.lines} IS NULL OR json_valid(${t.lines})`)],
);

/** web이 남기는 러너 확인 요청과 결과(RunnerHealth JSON). 러너마다 하나이고 다음 요청이 덮어쓴다(Q61). */
export const runnerCheckRequests = sqliteTable(
  "runner_check_requests",
  {
    runnerId: text("runner_id")
      .primaryKey()
      .references(() => runners.id, { onDelete: "cascade" })
      .$type<RunnerId>(),
    requestedAt: timeMs("requested_at").notNull(),
    completedAt: timeMs("completed_at"),
    result: text("result"),
    error: text("error"),
  },
  (t) => [
    check("runner_check_requests_result_json", sql`${t.result} IS NULL OR json_valid(${t.result})`),
  ],
);

/**
 * 에이전트 질문과 운영자 답(Q82.3·Q82.5). 러너는 메일을 소비하지 않으므로 어떤 질문을 받았고 답했는지는
 * 여기가 기준이다. worker가 질문을 쓰고(0016), web이 답을 남기면(답 요청) worker가 러너에 보낸 뒤
 * answer_sent_at을 한 번만 쓴다.
 */
export const runQuestions = sqliteTable(
  "run_questions",
  {
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" })
      .$type<RunId>(),
    questionId: text("question_id").notNull().$type<QuestionId>(),
    body: text("body").notNull(),
    options: text("options", { mode: "json" }).notNull().$type<string[]>(),
    askedAt: timeMs("asked_at").notNull(),
    /** 운영자가 남긴 답. 답 요청이다 */
    answer: text("answer"),
    answeredAt: timeMs("answered_at"),
    /** worker가 러너에 답을 보낸 시각. 처리 표시다 */
    answerSentAt: timeMs("answer_sent_at"),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.questionId] }),
    check("run_questions_options_json", sql`json_valid(${t.options})`),
    check("run_questions_answered", sql`(${t.answer} IS NULL) = (${t.answeredAt} IS NULL)`),
    check(
      "run_questions_sent_after_answer",
      sql`${t.answerSentAt} IS NULL OR ${t.answer} IS NOT NULL`,
    ),
    index("run_questions_unsent")
      .on(t.answeredAt)
      .where(sql`${t.answer} IS NOT NULL AND ${t.answerSentAt} IS NULL`),
  ],
);

/**
 * 에이전트 권한 대기와 운영자 거절(Q82.4·Q82.5). 허용은 러너 화면에서 사람만 하고, 오케스트레이터는 거절만
 * 한다. worker가 폴링에서 본 대기를 쓰고(0016), 더 이상 열려 있지 않으면 resolved_at을 쓴다. web이 거절을
 * 남기면(거절 요청, denied_at) worker가 러너에 보낸 뒤 deny_sent_at을 한 번만 쓴다.
 */
export const runPermissionWaits = sqliteTable(
  "run_permission_waits",
  {
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" })
      .$type<RunId>(),
    permissionId: text("permission_id").notNull().$type<PermissionRequestId>(),
    /** 무엇을 허용하려는지. 러너가 준 글 그대로 */
    detail: text("detail").notNull(),
    requestedAt: timeMs("requested_at").notNull(),
    /** 폴링에서 더 이상 열려 있지 않은 것을 본 시각(러너에서 허용했거나 거절이 닿았다) */
    resolvedAt: timeMs("resolved_at"),
    /** 운영자가 남긴 거절 이유. 거절 요청이다. 빈 글일 수 있다 */
    denyReason: text("deny_reason"),
    deniedAt: timeMs("denied_at"),
    /** worker가 러너에 거절을 보낸 시각. 처리 표시다 */
    denySentAt: timeMs("deny_sent_at"),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.permissionId] }),
    check("run_permission_waits_denied", sql`(${t.denyReason} IS NULL) = (${t.deniedAt} IS NULL)`),
    check(
      "run_permission_waits_sent_after_deny",
      sql`${t.denySentAt} IS NULL OR ${t.deniedAt} IS NOT NULL`,
    ),
    index("run_permission_waits_unsent")
      .on(t.deniedAt)
      .where(sql`${t.deniedAt} IS NOT NULL AND ${t.denySentAt} IS NULL`),
  ],
);

/**
 * web이 남기는 런 취소 요청(Q77·Q82.8·Q61). 런마다 하나다. 처리하지 않은 요청이 있으면 화면에
 * "취소 중"을 보인다(런 상태가 아니다, Q82.21). worker가 처리하면 processed_at을 한 번만 쓴다.
 */
export const runCancelRequests = sqliteTable("run_cancel_requests", {
  runId: text("run_id")
    .primaryKey()
    .references(() => runs.id, { onDelete: "cascade" })
    .$type<RunId>(),
  requestedAt: timeMs("requested_at").notNull(),
  processedAt: timeMs("processed_at"),
});
