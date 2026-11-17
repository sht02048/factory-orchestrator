import type { CiState } from "@factory/core";
import { z } from "zod";
import type { GitHubHttp } from "./http.js";

const workflowRuns = z.object({
  workflow_runs: z.array(
    z.object({
      status: z.string().nullable(),
      conclusion: z.string().nullable(),
    }),
  ),
});

/** 끝나 통과한 워크플로 런의 결론. */
const PASSED_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

/** 끝났지만 통과하지 못한 워크플로 런의 결론. 그 밖의 결론(stale, 모르는 값)은 pending으로 둔다. */
const FAILED_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "startup_failure",
]);

/**
 * 커밋 하나의 CI 상태를 GitHub Actions 워크플로 런으로 읽는다(research 0006 15절 대안 1, Q79).
 *
 * `GET /repos/{owner}/{repo}/actions/runs?head_sha=`는 Actions 읽기 권한을 요구한다. fine-grained PAT에
 * 그 권한이 없으면 비공개 저장소에서 404가 온다(`x-accepted-github-permissions: actions=read`). CI 상태는
 * 선택 표시라 PR 상태를 막지 않아야 하므로, 200이 아닌 응답과 연결 실패는 모두 "unavailable"(볼 수 없음)로
 * 돌려주고 던지지 않는다.
 */
export async function readCiState(
  http: GitHubHttp,
  owner: string,
  name: string,
  sha: string,
): Promise<CiState> {
  let res;
  try {
    res = await http.get(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=100`,
    );
  } catch {
    return "unavailable";
  }
  if (res.status !== 200) return "unavailable";
  const parsed = workflowRuns.safeParse(res.body);
  if (!parsed.success) return "unavailable";
  return summarizeRuns(parsed.data.workflow_runs);
}

/**
 * 워크플로 런 목록을 CI 상태 하나로 줄인다.
 * - 런이 없으면 none
 * - 하나라도 통과하지 못하고 끝났으면 failure
 * - 모두 끝나 통과했으면(success, neutral, skipped) success
 * - 그 밖에는 pending(끝나지 않은 런, 모르는 status·conclusion, stale). 모르는 값을 성공으로 보이지 않는다
 */
export function summarizeRuns(
  runs: ReadonlyArray<{ status: string | null; conclusion: string | null }>,
): CiState {
  if (runs.length === 0) return "none";
  if (runs.some((r) => r.status === "completed" && FAILED_CONCLUSIONS.has(r.conclusion ?? ""))) {
    return "failure";
  }
  const passed = runs.every(
    (r) => r.status === "completed" && PASSED_CONCLUSIONS.has(r.conclusion ?? ""),
  );
  return passed ? "success" : "pending";
}
