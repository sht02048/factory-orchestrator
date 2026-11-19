import type { BoundProject } from "@ganger/app/settings/model";

export interface RepoDraft {
  id: string;
  isDefault: boolean;
  labelId: string | null;
}

export interface MappingDraft {
  agent: string | null;
  model: string;
  repos: RepoDraft[];
}

export function mappingDraftOf(bound: BoundProject): MappingDraft {
  if (bound.mapping === null) return { agent: null, model: "", repos: [] };
  return {
    agent: bound.mapping.agent,
    model: bound.mapping.model ?? "",
    repos: bound.mapping.repos.map((repo) => ({ ...repo })),
  };
}

export function mappingDraftKey(draft: MappingDraft): string {
  return JSON.stringify(draft);
}

export function isCompleteDraft(draft: MappingDraft): draft is MappingDraft & { agent: string } {
  return draft.agent !== null && draft.repos.some((repo) => repo.isDefault);
}

export function withRepoAdded(draft: MappingDraft, id: string): MappingDraft {
  if (draft.repos.some((repo) => repo.id === id)) return draft;
  const isDefault = !draft.repos.some((repo) => repo.isDefault);
  return { ...draft, repos: [...draft.repos, { id, isDefault, labelId: null }] };
}

export function withRepoRemoved(draft: MappingDraft, id: string): MappingDraft {
  const target = draft.repos.find((repo) => repo.id === id);
  if (target === undefined || target.isDefault) return draft;
  return { ...draft, repos: draft.repos.filter((repo) => repo.id !== id) };
}

export function withDefaultRepo(draft: MappingDraft, id: string): MappingDraft {
  if (!draft.repos.some((repo) => repo.id === id)) return draft;
  return {
    ...draft,
    repos: draft.repos.map((repo) =>
      repo.id === id ? { ...repo, isDefault: true, labelId: null } : { ...repo, isDefault: false },
    ),
  };
}

export function withRepoLabel(
  draft: MappingDraft,
  id: string,
  labelId: string | null,
): MappingDraft {
  return {
    ...draft,
    repos: draft.repos.map((repo) =>
      repo.id === id && !repo.isDefault ? { ...repo, labelId } : repo,
    ),
  };
}

export function labelOwner(draft: MappingDraft, labelId: string, except: string): string | null {
  return draft.repos.find((repo) => repo.id !== except && repo.labelId === labelId)?.id ?? null;
}
