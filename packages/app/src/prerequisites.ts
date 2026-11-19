import { PREREQUISITE_FAILURE_KINDS } from "@ganger/core";
import type { PrerequisiteFailureKind } from "@ganger/core";

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

export interface CheckFailure {
  kind: PrerequisiteFailureKind;
  reason: string | null;
}

export interface PushCheckLike {
  id: string;
  project: string | null;
  satisfied: boolean | null;
  failure: CheckFailure | null;
}

export interface PushProblem {
  id: string;
  project: string;
  failure: CheckFailure | null;
}

export interface PushSummary {
  total: number;
  passed: number;
  failed: PushProblem[];
  unknown: PushProblem[];
  failedKinds: PrerequisiteFailureKind[];
}

export function isPushCheck(check: { id: string }): boolean {
  return prerequisiteKind(check.id).kind === "github-push";
}

export function runnerWideChecks<T extends { id: string }>(checks: ReadonlyArray<T>): T[] {
  return checks.filter((check) => !isPushCheck(check));
}

export function summarizePushChecks(checks: ReadonlyArray<PushCheckLike>): PushSummary {
  const push = checks.filter(isPushCheck);
  const problem = (check: PushCheckLike): PushProblem => ({
    id: check.id,
    project: check.project ?? prerequisiteKindProject(check.id),
    failure: check.failure,
  });
  const failed = push.filter((check) => check.satisfied === false).map(problem);
  const failedKinds = [
    ...new Set(failed.map((problem) => problem.failure?.kind ?? "other")),
  ].toSorted((a, b) => FAILURE_ORDER.indexOf(a) - FAILURE_ORDER.indexOf(b));
  return {
    total: push.length,
    passed: push.filter((check) => check.satisfied === true).length,
    failed,
    unknown: push.filter((check) => check.satisfied === null).map(problem),
    failedKinds,
  };
}

const FAILURE_ORDER: ReadonlyArray<PrerequisiteFailureKind> = PREREQUISITE_FAILURE_KINDS;

function prerequisiteKindProject(id: string): string {
  const kind = prerequisiteKind(id);
  return kind.kind === "github-push" ? kind.projectId : id;
}
