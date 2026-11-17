import { mentionsTicketKey, toCodeHostKind, toPullRequestId } from "@factory/core";
import type {
  CiState,
  CodeHost,
  CodeHostErrorDetail,
  CodeHostKind,
  ConnectionCheck,
  PullRequestId,
  PullRequestSnapshot,
  RepoRef,
  RunnerProjectId,
  TicketKey,
} from "@factory/core";
import { z } from "zod";
import { readCiState } from "./ci.js";
import { GitHubError, GitHubHttp } from "./http.js";
import type { GraphqlError, HttpOptions } from "./http.js";
import {
  PULL_REQUEST_BY_NUMBER,
  PULL_REQUESTS_BY_BRANCH,
  PULL_REQUESTS_BY_SEARCH,
  RATE_LIMIT_ONLY,
  VIEWER,
} from "./queries.js";
import { normalizeRepo, repoOfProject, splitRepo } from "./repo.js";

export const GITHUB_KIND: CodeHostKind = toCodeHostKind("github");

const isoDate = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

const pullRequestNode = z.object({
  number: z.number().int().positive(),
  url: z.string(),
  title: z.string(),
  body: z.string(),
  /** PullRequestState: OPEN, CLOSED, MERGED. 모르는 값도 받는다 */
  state: z.string(),
  createdAt: isoDate,
  mergedAt: isoDate.nullable(),
  headRefName: z.string(),
  headRefOid: z.string(),
  baseRefName: z.string(),
  isCrossRepository: z.boolean(),
  headRepository: z.object({ nameWithOwner: z.string() }).nullable(),
});
type PullRequestNode = z.infer<typeof pullRequestNode>;

const rateLimit = z.object({
  limit: z.number(),
  remaining: z.number(),
  resetAt: isoDate,
});

const byBranch = z.object({
  repository: z.object({ pullRequests: z.object({ nodes: z.array(pullRequestNode) }) }).nullable(),
});

const bySearch = z.object({
  search: z.object({
    // is:pr로 PR만 찾지만, 다른 노드가 와도 버리고 넘어간다. PR 노드의 모양이 틀리면 파싱이 실패한다.
    nodes: z
      .array(z.looseObject({ __typename: z.string() }))
      .transform((nodes) => nodes.filter((node) => node.__typename === "PullRequest"))
      .pipe(z.array(pullRequestNode.extend({ __typename: z.string() }))),
  }),
});

const byNumber = z.object({
  repository: z.object({ pullRequest: pullRequestNode.nullable() }).nullable(),
});

const viewer = z.object({ viewer: z.object({ login: z.string() }) });
const rateLimitOnly = z.object({ rateLimit });

export interface GitHubCodeHostOptions extends HttpOptions {}

/**
 * core `CodeHost`의 GitHub 구현. PR은 GraphQL로, CI 상태는 REST Actions API로 읽는다.
 * GitHub 고유 개념(owner/repo, PR 번호, headRefName 등)은 이 패키지 안에만 둔다(ADR 0008).
 *
 * - RepoRef는 소문자 `owner/repo`다.
 * - PullRequestId는 PR 번호를 문자열로 쓴 값이다(예: "7").
 */
export class GitHubCodeHost implements CodeHost {
  readonly kind: CodeHostKind = GITHUB_KIND;
  private readonly http: GitHubHttp;

  constructor(options: GitHubCodeHostOptions) {
    this.http = new GitHubHttp(options);
  }

  /**
   * 토큰이 맞고 GitHub에 닿는지 본다(온보딩·Settings, research 0002 C.4). CI를 읽을 권한은 저장소마다
   * 달라 여기서 정하지 않는다. CI를 읽다 권한 때문에 실패하면 그때 "볼 수 없음"이 된다(Q79).
   */
  async checkConnection(): Promise<ConnectionCheck<CodeHostErrorDetail>> {
    try {
      await this.http.graphql(VIEWER, {}, viewer);
      return { ok: true };
    } catch (error) {
      if (error instanceof GitHubError) return { ok: false, error: error.detail };
      throw error;
    }
  }

  repoOf(project: RunnerProjectId): RepoRef | null {
    return repoOfProject(project);
  }

  /** 같은 브랜치의 PR이 여럿이면(닫고 다시 연 경우) 모두 최신순으로 돌려준다. */
  async findPullRequestsByBranch(
    repo: RepoRef,
    branch: string,
  ): Promise<ReadonlyArray<PullRequestSnapshot>> {
    const { owner, name } = this.split(repo);
    const { data, errors } = await this.http.graphql(
      PULL_REQUESTS_BY_BRANCH,
      { owner, repo: name, branch },
      byBranch,
    );
    if (data.repository === null) throw repositoryMissing(errors);
    return this.snapshots(owner, name, data.repository.pullRequests.nodes);
  }

  /**
   * GraphQL `search(type: ISSUE_ADVANCED)`에 따옴표 친 키로 찾고(research 0006 20절), 받은 뒤 제목·본문에서
   * 키를 낱말 경계로 다시 걸러 낸다. `createdSince` 이후에 만든 PR만, 최신순으로 돌려준다.
   */
  async findPullRequestsByTicketKey(
    repo: RepoRef,
    ticketKey: TicketKey,
    opts: { createdSince: Date },
  ): Promise<ReadonlyArray<PullRequestSnapshot>> {
    const { owner, name } = this.split(repo);
    const { data } = await this.http.graphql(
      PULL_REQUESTS_BY_SEARCH,
      { q: searchQuery(owner, name, ticketKey, opts.createdSince) },
      bySearch,
    );
    const since = opts.createdSince.getTime();
    const nodes = data.search.nodes
      .filter(
        (pr) =>
          pr.createdAt.getTime() >= since &&
          (mentionsTicketKey(pr.title, ticketKey) || mentionsTicketKey(pr.body, ticketKey)),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return this.snapshots(owner, name, nodes);
  }

  /** PR 번호로 하나 조회한다. 그 번호의 PR이 없으면 null, 저장소에 닿지 못하면 not-found를 던진다. */
  async getPullRequest(repo: RepoRef, id: PullRequestId): Promise<PullRequestSnapshot | null> {
    const { owner, name } = this.split(repo);
    if (!/^[1-9][0-9]*$/.test(id)) return null;
    const { data, errors } = await this.http.graphql(
      PULL_REQUEST_BY_NUMBER,
      { owner, repo: name, number: Number(id) },
      byNumber,
    );
    if (data.repository === null) throw repositoryMissing(errors);
    const node = data.repository.pullRequest;
    if (node === null) return null;
    const [snapshot] = await this.snapshots(owner, name, [node]);
    return snapshot ?? null;
  }

  /**
   * GraphQL 점수 한도. 연달아 보낸 요청의 `used`가 서로 다른 계수기를 오가므로(research 0006 18절)
   * 차로 계산하지 말고 이 값의 `remaining`과 `resetAt`만 본다.
   */
  async rateLimit(): Promise<{ limit: number; remaining: number; resetAt: Date }> {
    const { data } = await this.http.graphql(RATE_LIMIT_ONLY, {}, rateLimitOnly);
    return data.rateLimit;
  }

  private split(repo: RepoRef): { owner: string; name: string } {
    const parts = splitRepo(repo);
    if (parts === null) throw new GitHubError({ kind: "not-found" });
    return parts;
  }

  /** CI 상태는 같은 커밋이면 한 번만 읽는다. */
  private async snapshots(
    owner: string,
    name: string,
    nodes: ReadonlyArray<PullRequestNode>,
  ): Promise<PullRequestSnapshot[]> {
    const ci = new Map<string, Promise<CiState>>();
    const ciOf = (sha: string): Promise<CiState> => {
      let state = ci.get(sha);
      if (state === undefined) {
        state = readCiState(this.http, owner, name, sha);
        ci.set(sha, state);
      }
      return state;
    };
    return Promise.all(nodes.map(async (node) => toSnapshot(node, await ciOf(node.headRefOid))));
  }
}

function toSnapshot(node: PullRequestNode, ci: CiState): PullRequestSnapshot {
  return {
    id: toPullRequestId(String(node.number)),
    displayId: `#${node.number}`,
    url: node.url,
    title: node.title,
    body: node.body,
    state: toState(node.state),
    createdAt: node.createdAt,
    mergedAt: node.mergedAt,
    headBranch: node.headRefName,
    // 포크에서 온 PR은 head 저장소가 달라 core가 거른다(research 0002 C.2).
    sourceRepo:
      node.headRepository === null ? null : normalizeRepo(node.headRepository.nameWithOwner),
    headCommit: node.headRefOid,
    baseBranch: node.baseRefName,
    ci,
  };
}

/** PullRequestState를 core 값으로. 모르는 값은 소문자로 그대로 넘긴다(core가 열림으로 다룬다). */
function toState(state: string): PullRequestSnapshot["state"] {
  switch (state) {
    case "OPEN":
      return "open";
    case "CLOSED":
      return "closed";
    case "MERGED":
      return "merged";
    default:
      return state.toLowerCase();
  }
}

/**
 * `repo:<owner>/<repo> is:pr "<키>" in:title,body created:>=<시각>`(research 0006 20절).
 * 검색 시각은 초 단위로 내림하고, 정확한 경계는 받은 뒤 `createdAt`으로 다시 거른다.
 * 키의 따옴표는 검색 문법을 깨므로 뺀다.
 */
export function searchQuery(
  owner: string,
  name: string,
  ticketKey: TicketKey,
  createdSince: Date,
): string {
  const seconds = Math.floor(createdSince.getTime() / 1000) * 1000;
  const since = new Date(seconds).toISOString().replace(".000Z", "Z");
  const key = ticketKey.replaceAll('"', "");
  return `repo:${owner}/${name} is:pr "${key}" in:title,body created:>=${since}`;
}

function repositoryMissing(errors: ReadonlyArray<GraphqlError>): GitHubError {
  if (errors.some((e) => e.type === "FORBIDDEN")) return new GitHubError({ kind: "unauthorized" });
  return new GitHubError({ kind: "not-found" });
}
