import {
  toAgentId,
  toLabelId,
  toRunnerId,
  toRunnerProjectId,
  toTicketKey,
  toTrackerConnectionId,
  toTrackerProjectId,
  toTrackerStateId,
} from "@factory/core";
import type {
  RunnerProject,
  TrackerLabel,
  TrackerProject,
  TrackerState,
  TrackerTicket,
} from "@factory/core";
import { toWorkspaceId } from "@factory/db";
import { FAIL_OFFLINE, FAIL_PUSH_AUTH } from "./values.js";

/*
 * 개발 진입점(티켓 0047)의 가상 값. 실제 서비스·계정·주소는 쓰지 않는다(ADR 0005). 트래커는 가짜 트래커가
 * 이 목록으로 답하고, 미리 채운 모드의 시드(seed.ts)도 같은 값을 DB 에 쓴다.
 *
 * 가짜 어댑터는 입력값으로 확인 결과를 정한다(world.ts, values.ts).
 */

export interface TrackerCatalog {
  projects: TrackerProject[];
  states: TrackerState[];
  labels: TrackerLabel[];
  tickets: TrackerTicket[];
}

export const agent = toAgentId("claude");
export const autoAssignLabel = toLabelId("label-factory");
export const inProgressState = toTrackerStateId("state-in-progress");

const states: TrackerState[] = [
  { id: toTrackerStateId("state-backlog"), name: "Backlog", category: "backlog" },
  { id: toTrackerStateId("state-todo"), name: "Todo", category: "unstarted" },
  { id: inProgressState, name: "In Progress", category: "started" },
  { id: toTrackerStateId("state-in-review"), name: "In Review", category: "started" },
  { id: toTrackerStateId("state-done"), name: "Done", category: "completed" },
];

const labels: TrackerLabel[] = [
  { id: autoAssignLabel, name: "factory" },
  { id: toLabelId("label-bug"), name: "bug" },
  { id: toLabelId("label-feature"), name: "feature" },
];

const todo = states[1] ?? states[0];

interface ProjectSpec {
  id: string;
  name: string;
  /** 러너 쪽 프로젝트(저장소). Mapping 이 고른다 */
  repo: string;
  titles: string[];
}

interface TrackerSpec {
  /** 트래커 연결 이름이자 API 키에 든 낱말 */
  name: string;
  keyPrefix: string;
  projects: ProjectSpec[];
}

const ACME: TrackerSpec = {
  name: "Acme",
  keyPrefix: "ACME",
  projects: [
    {
      id: "acme-web",
      name: "Web",
      repo: "acme/web",
      titles: [
        "Add a health check endpoint",
        "Show the build version in the footer",
        "Fix the date picker in Safari",
        "Lazy-load the settings page",
        "Add dark mode to the dashboard",
        "Remember the last opened tab",
        "Fix overflowing table headers",
        "Add keyboard shortcuts to the list",
        "Show an empty state on search",
        "Debounce the search input",
        "Paginate the audit log",
        "Add a copy button to code blocks",
        "Improve the 404 page",
        "Trim whitespace in form fields",
        "Fix the flicker on first load",
        "Add tooltips to icon buttons",
        "Sort projects by last update",
        "Add CSV export to reports",
        "Fix focus ring on dialogs",
        "Cache avatars in the browser",
      ],
    },
    {
      id: "acme-api",
      name: "API",
      repo: "acme/api",
      titles: [
        "Rate-limit the login endpoint",
        "Return 404 for unknown projects",
        "Add an index on runs.created_at",
        "Log slow queries over 500 ms",
        "Validate webhook payloads",
        "Add pagination to /projects",
        "Retry failed email deliveries",
        "Expire sessions after 30 days",
        "Add an OpenAPI description",
        "Compress large JSON responses",
        "Remove the deprecated v1 routes",
        "Add request IDs to logs",
        "Fix the timezone in reports",
        "Batch notification writes",
        "Add a readiness probe",
      ],
    },
  ],
};

const GLOBEX: TrackerSpec = {
  name: "Globex",
  keyPrefix: "GLX",
  projects: [
    {
      id: "globex-mobile",
      name: "Mobile",
      repo: "globex/mobile",
      titles: [
        "Support pull to refresh",
        "Fix the crash on rotate",
        "Add biometric login",
        "Shrink the app icon assets",
        "Show offline banner",
        "Fix push notification badge",
        "Add haptics to buttons",
        "Cache images on disk",
        "Localize the onboarding",
        "Fix keyboard covering inputs",
      ],
    },
  ],
};

export const TRACKERS: ReadonlyArray<TrackerSpec> = [ACME, GLOBEX];

/** API 키에 든 낱말로 트래커를 고른다. 모르는 키(온보딩에서 새로 넣은 값)는 Acme 다 */
export function trackerSpecFor(apiKey: string): TrackerSpec {
  const lower = apiKey.toLowerCase();
  return TRACKERS.find((spec) => lower.includes(spec.name.toLowerCase())) ?? ACME;
}

export function trackerProjectId(spec: ProjectSpec) {
  return toTrackerProjectId(spec.id);
}

export function runnerProjectId(spec: ProjectSpec) {
  return toRunnerProjectId(spec.repo);
}

/** 트래커 하나의 목록. 티켓 키는 프로젝트를 이어 1 부터 센다 */
export function trackerCatalog(spec: TrackerSpec, now: Date): TrackerCatalog {
  const tickets: TrackerTicket[] = [];
  let n = 0;
  for (const project of spec.projects) {
    for (const title of project.titles) {
      n += 1;
      const key = toTicketKey(`${spec.keyPrefix}-${n}`);
      tickets.push({
        key,
        title,
        body: `${title}.\n\nThis is a demo ticket with fake data.`,
        url: `https://tracker.example.com/${spec.name.toLowerCase()}/issue/${key}`,
        labels: [],
        project: { id: trackerProjectId(project), name: project.name },
        state: todo ?? { id: toTrackerStateId("state-todo"), name: "Todo", category: "unstarted" },
        updatedAt: new Date(now.getTime() - (n + 1) * 3_600_000),
      });
    }
  }
  return {
    projects: spec.projects.map((project) => ({
      id: trackerProjectId(project),
      name: project.name,
      url: `https://tracker.example.com/${spec.name.toLowerCase()}/project/${project.id}`,
    })),
    states,
    labels,
    tickets,
  };
}

/** 가짜 러너가 가진 러너 쪽 프로젝트(모든 저장소) */
export const RUNNER_PROJECTS: ReadonlyArray<RunnerProject> = TRACKERS.flatMap((spec) =>
  spec.projects.map((project) => ({
    id: runnerProjectId(project),
    displayName: project.repo,
    setupState: "ready",
  })),
);

// ---------- 미리 채운 모드의 설정 ----------

export const seededConnections = TRACKERS.map((spec) => ({
  spec,
  id: toTrackerConnectionId(`conn-${spec.name.toLowerCase()}`),
  workspaceId: toWorkspaceId(`ws-${spec.name.toLowerCase()}`),
  apiKey: `lin_api_demo_${spec.name.toLowerCase()}`,
  webhookSecret: `lin_wh_demo_${spec.name.toLowerCase()}`,
}));

/**
 * 러너 셋. runner-a 는 Online(진행 중인 런으로 가득 차 Queued 런이 기다린다), runner-b 는 GitHub 인증이 깨짐, runner-c 는 Offline(Disconnected 런이 있다).
 * 상태는 ssh 대상의 낱말로 가짜 러너가 정한다.
 */
export const seededRunners = [
  { id: toRunnerId("runner-a"), name: "runner-a", sshTarget: "runner-a.example.com", capacity: 3 },
  {
    id: toRunnerId("runner-b"),
    name: "runner-b",
    sshTarget: `runner-b-${FAIL_PUSH_AUTH}.example.com`,
    capacity: 2,
  },
  {
    id: toRunnerId("runner-c"),
    name: "runner-c",
    sshTarget: `runner-c-${FAIL_OFFLINE}.example.com`,
    capacity: 2,
  },
] as const;
