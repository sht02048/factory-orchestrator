import type { CiState, PullRequestSignals } from "@ganger/core";
import { z } from "zod";
import type { GitHubHttp } from "./http.js";
import { PULL_REQUEST_SIGNALS } from "./queries.js";

const checkContext = z.object({
  __typename: z.string(),
  name: z.string().optional(),
  conclusion: z.string().nullable().optional(),
  context: z.string().optional(),
  state: z.string().optional(),
});
type CheckContext = z.infer<typeof checkContext>;

const rollup = z.object({
  state: z.string(),
  contexts: z.object({
    totalCount: z.number().int().nonnegative(),
    pageInfo: z.object({ hasNextPage: z.boolean() }),
    nodes: z.array(checkContext.nullable()),
  }),
});

export const pullRequestSignalsResponse = z.object({
  repository: z.object({
    pullRequest: z.object({
      state: z.string(),
      mergeable: z.string(),
      baseRef: z
        .object({
          compare: z.object({ behindBy: z.number().int().nonnegative() }).nullable(),
        })
        .nullable(),
      commits: z.object({
        nodes: z.array(
          z
            .object({ commit: z.object({ oid: z.string(), statusCheckRollup: rollup.nullable() }) })
            .nullable(),
        ),
      }),
    }),
  }),
});
type SignalsResponse = z.infer<typeof pullRequestSignalsResponse>;

export interface PullRequestSignalsRead {
  ci: CiState | null;
  signals: PullRequestSignals;
}

const FAILED_CHECK_CONCLUSIONS = new Set([
  "FAILURE",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
]);
const FAILED_STATUS_STATES = new Set(["FAILURE", "ERROR"]);

export async function readPullRequestSignals(
  http: GitHubHttp,
  owner: string,
  name: string,
  pr: { number: number; headRefOid: string },
): Promise<PullRequestSignalsRead | null> {
  try {
    const { data } = await http.graphql(
      PULL_REQUEST_SIGNALS,
      { owner, repo: name, number: pr.number, head: pr.headRefOid },
      pullRequestSignalsResponse,
    );
    return toSignalsRead(data, pr.headRefOid);
  } catch {
    return null;
  }
}

export function toSignalsRead(
  data: SignalsResponse,
  headCommit: string,
): PullRequestSignalsRead | null {
  const pr = data.repository.pullRequest;
  const commit = pr.commits.nodes.at(-1)?.commit;
  if (commit?.oid !== headCommit) return null;
  const checks = commit.statusCheckRollup;
  const open = pr.state === "OPEN";
  const failed = checks === null ? [] : failedNames(checks.contexts.nodes);
  const ci = checks === null ? null : ciOfRollup(checks.state);
  return {
    ci,
    signals: {
      open,
      headCommit,
      ciFailed: ci === "failure" || failed.length > 0,
      checkTotal: checks?.contexts.totalCount ?? null,
      failedCount: failed.length,
      failedChecks: [...new Set(failed)],
      checksTruncated: checks?.contexts.pageInfo.hasNextPage ?? false,
      conflict: open ? conflictOf(pr.mergeable) : null,
      behindBy: open ? (pr.baseRef?.compare?.behindBy ?? null) : null,
    },
  };
}

function ciOfRollup(state: string): CiState {
  switch (state) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "ERROR":
      return "failure";
    case "PENDING":
    case "EXPECTED":
      return "pending";
    default:
      return "unavailable";
  }
}

function conflictOf(mergeable: string): boolean | null {
  if (mergeable === "CONFLICTING") return true;
  return mergeable === "MERGEABLE" ? false : null;
}

function failedNames(nodes: ReadonlyArray<CheckContext | null>): string[] {
  return nodes.flatMap((node) => {
    if (node?.__typename === "CheckRun" && node.name !== undefined) {
      return FAILED_CHECK_CONCLUSIONS.has(node.conclusion ?? "") ? [node.name] : [];
    }
    if (node?.__typename === "StatusContext" && node.context !== undefined) {
      return FAILED_STATUS_STATES.has(node.state ?? "") ? [node.context] : [];
    }
    return [];
  });
}
