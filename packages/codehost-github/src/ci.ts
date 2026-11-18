import type { CiState } from "@ganger/core";
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

const PASSED_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

const FAILED_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "startup_failure",
]);

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
