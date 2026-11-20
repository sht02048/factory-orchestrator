import type {
  BoundProjectReads,
  Choice,
  ConnectionLabel,
  ConnectionLabelSettings,
  ConnectionProjects,
  ProjectOwnership,
  Remote,
  SettingsDbPage,
  SettingsPage,
  TrackerProjectChoice,
  TrackerProjectList,
} from "./model.js";

export interface SettingsTrackerReads {
  projects: ReadonlyArray<TrackerProjectList>;
  reads: ReadonlyArray<BoundProjectReads>;
}

const NOT_READ_YET: Remote<Choice> = { ok: true, items: [] };

const byName = (a: Choice, b: Choice) => a.name.localeCompare(b.name);

export function connectionProjectsOf(
  connections: ReadonlyArray<Choice>,
  ownership: ReadonlyArray<ProjectOwnership>,
  lists: ReadonlyArray<TrackerProjectList>,
): ConnectionProjects[] {
  return connections.map((connection): ConnectionProjects => {
    const listed = lists.find((list) => list.connection === connection.id)?.projects;
    const read = listed ?? NOT_READ_YET;
    const owned = ownership.filter((project) => project.connection === connection.id);
    const seen = new Map<string, Choice>();
    for (const project of read.ok ? read.items : []) seen.set(project.id, project);
    for (const project of owned) {
      if (project.owner.kind === "this" && !seen.has(project.projectId))
        seen.set(project.projectId, { id: project.projectId, name: project.name });
    }
    const projects = [...seen.values()].map((project): TrackerProjectChoice => {
      const known = owned.find((candidate) => candidate.projectId === project.id);
      return {
        id: project.id,
        name: project.name,
        owner: known?.owner ?? { kind: "free" },
        mappings: known?.mappings ?? 0,
        queuedRuns: known?.queuedRuns ?? 0,
      };
    });
    return { connection, error: read.ok ? null : read.error, projects };
  });
}

function readsOf(
  reads: ReadonlyArray<BoundProjectReads>,
  connection: string,
  projectId: string,
): BoundProjectReads | undefined {
  return reads.find((read) => read.connection === connection && read.projectId === projectId);
}

function connectionLabelOf(
  label: ConnectionLabelSettings,
  reads: ReadonlyArray<BoundProjectReads>,
): ConnectionLabel {
  const lists = label.projectIds.map(
    (projectId) => readsOf(reads, label.connection.id, projectId)?.labels ?? NOT_READ_YET,
  );
  const failed = lists.find((list) => !list.ok);
  const unique = new Map<string, Choice>();
  for (const list of lists) if (list.ok) for (const item of list.items) unique.set(item.id, item);
  return {
    connection: label.connection,
    labelId: label.labelId,
    repoLabels: label.repoLabels,
    labels:
      failed !== undefined && !failed.ok
        ? { ok: false, error: failed.error }
        : { ok: true, items: [...unique.values()].toSorted(byName) },
  };
}

export function mergeSettingsPage(db: SettingsDbPage, tracker: SettingsTrackerReads): SettingsPage {
  const workspace = db.workspace;
  return {
    install: db.install,
    runnerProjects: db.runnerProjects,
    agents: db.agents,
    workspace:
      workspace === null
        ? null
        : {
            general: workspace.general,
            trackerProjects: connectionProjectsOf(
              workspace.connections,
              workspace.ownership,
              tracker.projects,
            ),
            bound: workspace.bound.map((bound) => {
              const read = readsOf(tracker.reads, bound.connection.id, bound.project.id);
              return {
                ...bound,
                states: read?.states ?? NOT_READ_YET,
                labels: read?.labels ?? NOT_READ_YET,
              };
            }),
            labels: workspace.labels.map((label) => connectionLabelOf(label, tracker.reads)),
          },
  };
}
