import {
  toAgentId,
  toLabelId,
  toRunnerId,
  toRunnerProjectId,
  toTicketKey,
  toTrackerConnectionId,
  toTrackerProjectId,
  toTrackerStateId,
} from "@ganger/core";
import type {
  RunnerProject,
  TrackerLabel,
  TrackerProject,
  TrackerState,
  TrackerTicket,
} from "@ganger/core";
import { toWorkspaceId } from "@ganger/db";
import { FAIL_OFFLINE, FAIL_PUSH_AUTH } from "./values.js";

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
  repo: string;
  titles: string[];
}

interface TrackerSpec {
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

export const RUNNER_PROJECTS: ReadonlyArray<RunnerProject> = TRACKERS.flatMap((spec) =>
  spec.projects.map((project) => ({
    id: runnerProjectId(project),
    displayName: project.repo,
    setupState: "ready",
  })),
);

export const seededConnections = TRACKERS.map((spec) => ({
  spec,
  id: toTrackerConnectionId(`conn-${spec.name.toLowerCase()}`),
  workspaceId: toWorkspaceId(`ws-${spec.name.toLowerCase()}`),
  apiKey: `lin_api_demo_${spec.name.toLowerCase()}`,
  webhookSecret: `lin_wh_demo_${spec.name.toLowerCase()}`,
}));

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
