import { toRepoRef } from "@factory/core";
import type { RepoRef, RunnerProjectId } from "@factory/core";

const PROJECT = /^github:([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+)$/;
const REPO = /^([a-z0-9][a-z0-9-]*)\/([a-z0-9._-]+)$/;

export function normalizeRepo(nameWithOwner: string): RepoRef {
  return toRepoRef(nameWithOwner.toLowerCase());
}

export function repoOfProject(project: RunnerProjectId): RepoRef | null {
  const match = PROJECT.exec(project);
  if (match === null) return null;
  const [, owner, name] = match;
  if (owner === undefined || name === undefined) return null;
  return normalizeRepo(`${owner}/${name}`);
}

export function splitRepo(repo: RepoRef): { owner: string; name: string } | null {
  const match = REPO.exec(repo);
  if (match === null) return null;
  const [, owner, name] = match;
  if (owner === undefined || name === undefined) return null;
  return { owner, name };
}
