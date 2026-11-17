import { toRepoRef } from "@factory/core";
import type { RepoRef, RunnerProjectId } from "@factory/core";

/**
 * 러너 쪽 프로젝트 ID 중 GitHub 저장소를 가리키는 꼴. Orca는 `github:<owner>/<repo>`로 준다
 * (research 0002 A.4). owner는 영숫자와 `-`, 저장소 이름은 영숫자와 `.`·`_`·`-`다.
 */
const PROJECT = /^github:([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+)$/;
const REPO = /^([a-z0-9][a-z0-9-]*)\/([a-z0-9._-]+)$/;

/**
 * GitHub 저장소 이름은 대소문자를 가리지 않는다. RepoRef는 문자열 비교로 같은지 보므로(core ids.ts)
 * `owner/repo`를 소문자로 맞춘다. PR의 `sourceRepo`도 같은 함수로 만든다.
 */
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

/** RepoRef를 GraphQL 변수로 나눈다. 이 어댑터가 만든 값이 아니면 null */
export function splitRepo(repo: RepoRef): { owner: string; name: string } | null {
  const match = REPO.exec(repo);
  if (match === null) return null;
  const [, owner, name] = match;
  if (owner === undefined || name === undefined) return null;
  return { owner, name };
}
