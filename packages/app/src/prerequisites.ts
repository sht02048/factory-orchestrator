export type PrerequisiteKind =
  | { kind: "orca-service" }
  | { kind: "github-push"; projectId: string }
  | { kind: "other" };

const GITHUB_PUSH = "github-push:";

export function prerequisiteKind(id: string): PrerequisiteKind {
  if (id === "orca-service") return { kind: "orca-service" };
  if (id.startsWith(GITHUB_PUSH))
    return { kind: "github-push", projectId: id.slice(GITHUB_PUSH.length) };
  return { kind: "other" };
}

export function prerequisiteProject(
  id: string,
  projects: ReadonlyArray<{ id: string; displayName: string }>,
): string | null {
  const kind = prerequisiteKind(id);
  if (kind.kind !== "github-push") return null;
  return projects.find((p) => p.id === kind.projectId)?.displayName ?? null;
}

export function prerequisiteHint(prerequisite: { id: string; hint: string | null }): string | null {
  return prerequisiteKind(prerequisite.id).kind === "github-push" ? null : prerequisite.hint;
}
