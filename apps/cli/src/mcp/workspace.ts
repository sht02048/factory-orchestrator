import { listWorkspaces } from "@ganger/db";
import type { Database } from "@ganger/db";

export interface WorkspaceRef {
  id: string;
  name: string;
}

export type WorkspacePick =
  | { ok: true; workspace: WorkspaceRef }
  | { ok: false; error: string; workspaces: WorkspaceRef[] };

export function workspaceRefs(db: Database): WorkspaceRef[] {
  return listWorkspaces(db).map((w): WorkspaceRef => ({ id: w.id, name: w.name }));
}

export function pickWorkspace(db: Database, given: string | undefined): WorkspacePick {
  const workspaces = workspaceRefs(db);
  if (given !== undefined) {
    const byId = workspaces.find((w) => w.id === given);
    if (byId !== undefined) return { ok: true, workspace: byId };
    const byName = workspaces.filter((w) => w.name === given);
    const [named, ...sameName] = byName;
    if (named !== undefined && sameName.length === 0) return { ok: true, workspace: named };
    if (named !== undefined) {
      return {
        ok: false,
        error: `More than one workspace is named "${given}". Pass its id instead.`,
        workspaces,
      };
    }
    return { ok: false, error: `No workspace has the id or name "${given}".`, workspaces };
  }
  const [only, ...others] = workspaces;
  if (only === undefined) {
    return {
      ok: false,
      error: "There is no workspace yet. Finish onboarding in the Ganger app first.",
      workspaces,
    };
  }
  if (others.length > 0) {
    return {
      ok: false,
      error: "There is more than one workspace. Pass workspace as one of these ids or names.",
      workspaces,
    };
  }
  return { ok: true, workspace: only };
}
