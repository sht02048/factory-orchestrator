/*
 * Settings 화면이 보이는 값과 저장 결과. server function 이 돌려주고 화면이 그린다. DB 를 들여오지 않는다.
 * 화면 문구는 담지 않고 열거값만 담는다. 문구는 메시지 파일이 정한다.
 *
 * Settings 는 이 Workspace 와 설치 전체로 나눈다(ADR 0006·0007).
 * - 이 Workspace: 이름·최대 실행 시간, 트래커 프로젝트, Mapping, "In Progress" 상태, Auto-assign Label
 * - 설치 전체: 트래커 연결, GitHub 토큰, 러너 등록
 * 비밀값(API 키, signing secret, 토큰)은 화면에 돌려주지 않는다. 저장했는지만 알린다.
 */

/** 왼쪽 목록의 항목. 앞 다섯은 이 Workspace, 뒤 셋은 설치 전체다 */
export const WORKSPACE_ITEMS = ["general", "projects", "mapping", "progress", "label"] as const;
export const INSTALL_ITEMS = ["connections", "github", "runners"] as const;
export type WorkspaceItem = (typeof WORKSPACE_ITEMS)[number];
export type InstallItem = (typeof INSTALL_ITEMS)[number];
export type SettingsItem = WorkspaceItem | InstallItem;

export function isSettingsItem(value: string | undefined): value is SettingsItem {
  return (
    value !== undefined &&
    (WORKSPACE_ITEMS.some((item) => item === value) || INSTALL_ITEMS.some((item) => item === value))
  );
}

/**
 * 연결 확인이나 원격 목록 읽기가 실패한 까닭(core TrackerErrorDetail·CodeHostErrorDetail 의 종류).
 * invalid: 설정을 어댑터가 받지 못함(예: 빈 키)
 */
export type RemoteError = "unauthorized" | "rate-limited" | "not-found" | "network" | "invalid";

/** 원격(트래커)에서 읽은 목록. 읽지 못했으면 까닭을 담는다 */
export type Remote<T> = { ok: true; items: T[] } | { ok: false; error: RemoteError };

export interface Choice {
  id: string;
  name: string;
}

export interface WorkspaceGeneral {
  id: string;
  name: string;
  /** 최대 실행 시간(분). Workspace별 설정이고 기본 120분이다(스펙 3절 6번) */
  maxRunMinutes: number;
}

/** 트래커 프로젝트 하나를 이 Workspace 에 넣을 수 있는지 */
export type ProjectOwner =
  | { kind: "free" }
  | { kind: "this" }
  /** 다른 Workspace 에 묶여 고를 수 없다(ADR 0006) */
  | { kind: "other"; workspace: Choice };

export interface TrackerProjectChoice {
  id: string;
  name: string;
  owner: ProjectOwner;
  /** 이 Workspace 에서 빼면 함께 지워질 Mapping 수(0 또는 1) */
  mappings: number;
  /** 그 Mapping 을 쓰는 Queued 런 수. 빼면 시작할 수 없음으로 끝난다(Q82.16) */
  queuedRuns: number;
}

/** 트래커 연결 하나의 트래커 프로젝트. 트래커에서 읽지 못해도 이 Workspace 에 묶인 것은 DB 에서 보인다 */
export interface ConnectionProjects {
  connection: Choice;
  /** 트래커 목록을 읽지 못했으면 그 까닭 */
  error: RemoteError | null;
  projects: TrackerProjectChoice[];
}

/** 이 Workspace 에 묶인 트래커 프로젝트 하나와 그 Mapping, "In Progress" 상태 */
export interface BoundProject {
  connection: Choice;
  project: Choice;
  mapping: { runnerProject: string; agent: string } | null;
  inProgressStateId: string | null;
  /** 그 트래커 프로젝트의 상태(트래커에서 읽음) */
  states: Remote<Choice>;
}

/** 트래커 연결 하나의 Auto-assign Label. 라벨은 연결마다 달라 Workspace × 연결마다 하나다 */
export interface ConnectionLabel {
  connection: Choice;
  labelId: string | null;
  /** 이 Workspace 의 그 연결 트래커 프로젝트들에서 쓸 수 있는 라벨 */
  labels: Remote<Choice>;
}

export interface WorkspaceSettings {
  general: WorkspaceGeneral;
  trackerProjects: ConnectionProjects[];
  bound: BoundProject[];
  labels: ConnectionLabel[];
}

export interface TrackerConnectionView {
  id: string;
  name: string;
  /** webhook signing secret 을 저장했는지 */
  hasWebhookSecret: boolean;
  /** webhook 을 받는 경로. 운영자가 연 공개 주소 뒤에 붙인다 */
  webhookPath: string;
}

/** 러너 확인 결과의 필수 조건 하나(core RunnerPrerequisite) */
export interface PrerequisiteView {
  id: string;
  name: string;
  satisfied: boolean | null;
  hint: string | null;
  /** GitHub push 항목의 러너 쪽 프로젝트 표시 이름. 그 밖의 항목이거나 찾지 못하면 null */
  project: string | null;
  /** 깨지면 할당에서 빠지는 조건(1단계는 GitHub 인증, Q82.14) */
  blocksAssignment: boolean;
}

/** 러너 확인 요청과 worker 가 쓴 결과(Q61) */
export type RunnerCheckView =
  | { status: "pending"; requestedAt: string }
  | { status: "failed"; completedAt: string; error: string }
  | {
      status: "done";
      completedAt: string;
      online: boolean;
      version: string | null;
      prerequisites: PrerequisiteView[];
      /** 러너 오류 종류(core RunnerErrorDetail.kind). 없으면 null */
      error: string | null;
    }
  /** 결과를 읽지 못함(저장된 모양이 다름) */
  | { status: "unreadable"; completedAt: string };

export interface RunnerSettingsView {
  id: string;
  name: string;
  sshTarget: string;
  orcaPath: string;
  capacity: number;
  /** 확인을 요청한 적 없으면 null */
  check: RunnerCheckView | null;
}

export interface InstallSettings {
  connections: TrackerConnectionView[];
  /** GitHub 토큰을 저장했는지 */
  githubToken: boolean;
  runners: RunnerSettingsView[];
}

export interface SettingsPage {
  /** 현재 Workspace. "전체"를 골랐거나 Workspace 가 없으면 null */
  workspace: WorkspaceSettings | null;
  install: InstallSettings;
  /** Mapping 에서 고를 러너 쪽 프로젝트. 모든 러너의 것을 모은다(러너는 고르지 않는다, Q53) */
  runnerProjects: Choice[];
  /** Mapping 에서 고를 에이전트 */
  agents: string[];
}

/** 최대 실행 시간 상한(분). 일주일이면 넉넉하다. 화면과 서버가 함께 쓴다 */
export const MAX_RUN_MINUTES = 7 * 24 * 60;

/** 러너 확인 결과를 기다리는 동안 상태만 다시 읽는 간격과, 그만 기다리는 시간 */
export const RUNNER_CHECK_POLL_MS = 3000;
export const RUNNER_CHECK_POLL_LIMIT_MS = 2 * 60 * 1000;

/** 이미 아는 에이전트(GLOSSARY Agent). 화면 이름은 메시지 파일에 있다. 저장된 다른 값도 고를 수 있게 남긴다 */
export const KNOWN_AGENTS = ["claude", "codex"] as const;

/** 저장 결과. 실패 까닭은 화면이 문구로 바꾼다 */
export type SaveResult<R extends string = never> = { ok: true } | { ok: false; reason: R };

export type ConnectionSaveReason = RemoteError | "missing-key" | "not-found";
