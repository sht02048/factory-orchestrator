/**
 * 1단계 스키마. 뒤 티켓(0016~0018, 0022, 0025~0027)이 쓰는 테이블을 모두 여기서 만든다.
 *
 * 확장 원칙: core 타입(Run 상태, 두 축, 이후 PR 상태, 어댑터 종류 + 불투명한 외부 ID)만 컬럼으로 두고,
 * 특정 서비스(Linear, Orca, GitHub)에만 있는 값은 어댑터 설정 JSON(`config`)과 봉한 비밀값
 * (`secrets`)에 둔다. 새 어댑터 종류를 더해도 스키마를 바꾸지 않는다.
 *
 * 시각은 모두 Unix epoch 밀리초 INTEGER다.
 * 요약 결과, Failed 사유, 워크트리 처리는 저장하지 않는다. core 요약 계산 함수로 계산한다(Q66·Q71).
 */
export const sql = /* sql */ `
-- 설치 단위 Tracker Connection(ADR 0006). API 키, webhook signing secret은 secrets에 봉해 둔다.
CREATE TABLE tracker_connections (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config)),
  secrets TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 설치 단위 코드 호스트 연결(GitHub 토큰). 토큰은 secrets에 봉해 둔다.
CREATE TABLE code_host_connections (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config)),
  secrets TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 설치 단위 Runner(ADR 0006). ssh 대상, orca 경로 같은 어댑터 값은 config에 둔다.
CREATE TABLE runners (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config)),
  capacity INTEGER NOT NULL CHECK (capacity >= 1),
  online INTEGER NOT NULL DEFAULT 0 CHECK (online IN (0, 1)),
  -- 마지막 상태 확인 시각과 그때의 오류(RunnerErrorDetail JSON). 확인한 적 없으면 NULL
  checked_at INTEGER,
  check_error TEXT CHECK (check_error IS NULL OR json_valid(check_error)),
  created_at INTEGER NOT NULL
);

-- 러너가 가진 러너 쪽 프로젝트. worker의 러너 확인이 덮어쓴다(0016).
CREATE TABLE runner_projects (
  runner_id TEXT NOT NULL REFERENCES runners (id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  setup_state TEXT NOT NULL,
  PRIMARY KEY (runner_id, project_id)
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  max_run_ms INTEGER NOT NULL DEFAULT 7200000 CHECK (max_run_ms > 0),
  created_at INTEGER NOT NULL
);

-- Workspace의 트래커 프로젝트. 기본 키가 트래커 프로젝트라 한 Workspace에만 속한다(ADR 0006).
-- "In Progress" 상태는 트래커 상태가 트래커 프로젝트(팀)마다 달라 여기 둔다(Tracker.listStates).
CREATE TABLE workspace_tracker_projects (
  tracker_connection_id TEXT NOT NULL REFERENCES tracker_connections (id),
  tracker_project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  in_progress_state_id TEXT,
  PRIMARY KEY (tracker_connection_id, tracker_project_id)
);
CREATE INDEX workspace_tracker_projects_workspace ON workspace_tracker_projects (workspace_id);

-- Mapping: 트래커 프로젝트 → 러너 쪽 프로젝트·에이전트. 러너는 고르지 않는다(Q53).
CREATE TABLE mappings (
  tracker_connection_id TEXT NOT NULL,
  tracker_project_id TEXT NOT NULL,
  runner_project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  PRIMARY KEY (tracker_connection_id, tracker_project_id),
  FOREIGN KEY (tracker_connection_id, tracker_project_id)
    REFERENCES workspace_tracker_projects (tracker_connection_id, tracker_project_id)
    ON DELETE CASCADE
);

-- Auto-assign Label. 라벨은 트래커 연결마다 달라 Workspace × 트래커 연결마다 하나다.
CREATE TABLE auto_assign_labels (
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  tracker_connection_id TEXT NOT NULL REFERENCES tracker_connections (id),
  label_id TEXT NOT NULL,
  PRIMARY KEY (workspace_id, tracker_connection_id)
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  tracker_connection_id TEXT NOT NULL REFERENCES tracker_connections (id),
  ticket_key TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id),
  tracker_project_id TEXT NOT NULL,
  runner_project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  -- 오케스트레이터가 정한 브랜치(Q40)
  branch TEXT NOT NULL,
  state TEXT NOT NULL
    CHECK (state IN ('queued', 'running', 'waiting-for-input', 'disconnected', 'ended')),
  -- Queued에서는 비울 수 있다(맞는 러너가 모두 Offline, Q65·Q72)
  runner_id TEXT REFERENCES runners (id),
  -- 대기열 순서이기도 하다(Q73)
  assigned_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  worktree_ref TEXT,
  -- 응답을 잃은 시작을 다시 보낼 값(Orca operationId, --retry-launch)
  retry_token TEXT,
  -- 두 축. Ended에서만 있고 그 뒤 바꾸지 않는다(ADR 0004, Q69)
  agent_result TEXT CHECK (agent_result IN (
    'exited-normally', 'exited-with-error', 'timed-out',
    'stopped-waiting-for-input', 'runner-disconnected', 'worktree-missing'
  )),
  pr_state TEXT CHECK (pr_state IN ('none', 'open', 'merged', 'closed')),
  -- 런과 이어진 PR과 그 CI 상태(worker가 폴링해 쓴다, 0017)
  pr_id TEXT,
  pr_display_id TEXT,
  pr_url TEXT,
  pr_ci_state TEXT,
  pr_checked_at INTEGER,
  -- 이후 PR 상태(Q54·Q69)
  later_pr_state TEXT CHECK (later_pr_state IN ('merged', 'closed')),
  later_pr_state_at INTEGER,
  -- 워크트리를 지운 시각. worker가 지웠거나 사람이 지운 것을 확인한 때(Q75)
  worktree_removed_at INTEGER,
  -- 트래커 갱신 기록. 재시작해도 두 번 하지 않는다(0017)
  tracker_state_set_at INTEGER,
  tracker_comment_id TEXT,
  tracker_commented_at INTEGER,
  -- ssh 연속 실패가 시작된 시각. 한 번이라도 닿으면 NULL(Q50)
  unreachable_since INTEGER,
  -- 런이 끝날 때 저장한 마지막 로그 200줄(JSON 문자열 배열, Q46)
  last_log TEXT CHECK (last_log IS NULL OR json_valid(last_log)),
  CHECK ((state = 'queued') = (started_at IS NULL)),
  CHECK (state = 'queued' OR (runner_id IS NOT NULL AND worktree_ref IS NOT NULL)),
  CHECK ((state = 'ended') = (ended_at IS NOT NULL)),
  CHECK ((state = 'ended') = (agent_result IS NOT NULL)),
  CHECK ((state = 'ended') = (pr_state IS NOT NULL)),
  CHECK (later_pr_state IS NULL OR state = 'ended')
  -- 트래커 프로젝트는 외래 키로 묶지 않는다. Workspace에서 빼도 지난 런과 통계는 남는다.
);
-- 티켓당 Ended가 아닌 런은 하나다(Q45·Q74). web과 worker가 동시에 할당해도 DB가 막는다.
CREATE UNIQUE INDEX runs_one_active_per_ticket
  ON runs (tracker_connection_id, ticket_key) WHERE state <> 'ended';
CREATE INDEX runs_ticket ON runs (tracker_connection_id, ticket_key, assigned_at);
CREATE INDEX runs_state ON runs (state, assigned_at);
CREATE INDEX runs_workspace ON runs (workspace_id, assigned_at);

-- 런 상태 변경 이력. Waiting for Input·Disconnected에 들어가고 나온 시각을 담는다(Q52·Q67).
-- 할당은 from_state가 NULL인 행이다.
CREATE TABLE run_state_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  from_state TEXT,
  to_state TEXT NOT NULL,
  changed_at INTEGER NOT NULL
);
CREATE INDEX run_state_changes_run ON run_state_changes (run_id, id);

-- 검증을 통과한 webhook 이벤트. 기본 키가 중복 제거 키(Linear-Delivery)다(research 0002 B.2).
CREATE TABLE tracker_events (
  tracker_connection_id TEXT NOT NULL REFERENCES tracker_connections (id),
  delivery_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  tracker_project_id TEXT,
  ticket_key TEXT,
  label_ids TEXT CHECK (label_ids IS NULL OR json_valid(label_ids)),
  received_at INTEGER NOT NULL,
  processed_at INTEGER,
  PRIMARY KEY (tracker_connection_id, delivery_id)
);
CREATE INDEX tracker_events_unprocessed ON tracker_events (received_at) WHERE processed_at IS NULL;

-- web이 남기는 로그 꼬리 요청과 결과. 런마다 하나이고 다음 요청이 덮어쓴다(Q46·Q61).
CREATE TABLE log_tail_requests (
  run_id TEXT PRIMARY KEY REFERENCES runs (id) ON DELETE CASCADE,
  requested_at INTEGER NOT NULL,
  completed_at INTEGER,
  lines TEXT CHECK (lines IS NULL OR json_valid(lines)),
  error TEXT
);

-- web이 남기는 러너 확인 요청과 결과(RunnerHealth JSON). 러너마다 하나이고 다음 요청이 덮어쓴다(Q61).
CREATE TABLE runner_check_requests (
  runner_id TEXT PRIMARY KEY REFERENCES runners (id) ON DELETE CASCADE,
  requested_at INTEGER NOT NULL,
  completed_at INTEGER,
  result TEXT CHECK (result IS NULL OR json_valid(result)),
  error TEXT
);
`;
