import { describe, expect, test } from "vitest";
import { decideProgress } from "./progress.js";
import type { ProgressInput } from "./progress.js";
import { checkResultSchema, workerShowResultSchema } from "./schemas.js";
import { peekOf, research } from "./test-support.js";

function worker(file: string): ProgressInput["worker"] {
  const parsed: unknown = JSON.parse(research(`0008/${file}`));
  if (typeof parsed !== "object" || parsed === null || !("result" in parsed)) throw new Error();
  return workerShowResultSchema.parse(parsed.result);
}

function mails(...files: string[]): ProgressInput["mails"] {
  const parsed: unknown = JSON.parse(peekOf(...files.map((f) => research(`0008/${f}`))));
  if (typeof parsed !== "object" || parsed === null || !("result" in parsed)) throw new Error();
  return checkResultSchema.parse(parsed.result).messages;
}

const r2 = {
  dispatchId: "ctx_000000000002",
  taskResult: null,
  worker: worker("worker-show-agent-exited-shell-live.json"),
  worktreeRow: "unknown",
  worktreeExists: true,
} satisfies Omit<ProgressInput, "mails">;

describe("decideProgress", () => {
  test("an open permission prompt is a permission wait to deny", () => {
    const progress = decideProgress({
      ...r2,
      worker: { ...r2.worker, liveness: "live" },
      mails: mails("escalation-needs-input-full.json"),
    });
    expect(progress).toEqual({
      kind: "active",
      questions: [],
      permissionWaits: [
        {
          id: "apr_0000000000000001",
          detail: "Allow Bash?: touch perm-test.txt",
          requestedAt: new Date("2026-11-17T14:09:37Z"),
        },
      ],
    });
  });

  test("an answered permission prompt is no longer waiting", () => {
    const progress = decideProgress({
      ...r2,
      worker: { ...r2.worker, liveness: "live" },
      mails: mails("escalation-needs-input-full.json", "status-approval-answered-full.json"),
    });
    expect(progress).toEqual({ kind: "active", questions: [], permissionWaits: [] });
  });

  test("mail for another run is ignored", () => {
    const progress = decideProgress({
      ...r2,
      dispatchId: "ctx_000000000001",
      worker: { ...r2.worker, liveness: "live" },
      mails: mails("escalation-needs-input-full.json", "escalation-lost-full.json"),
    });
    expect(progress).toEqual({ kind: "active", questions: [], permissionWaits: [] });
  });

  test("an agent that died and left only its shell is ended without report", () => {
    const progress = decideProgress({
      ...r2,
      dispatchId: "ctx_000000000003",
      mails: [],
      worktreeRow: {
        worktreeId: "10000000-0000-4000-8000-000000000004::<path>/workspaces/sandbox/fo-orch-r3",
        liveTerminalCount: 1,
        agents: [],
      },
    });
    expect(progress).toEqual({
      kind: "ended-without-report",
      detail: "agent exited and only its shell is left in the worktree",
    });
  });

  test("an unverifiable agent still listed in the worktree is still running", () => {
    const progress = decideProgress({
      ...r2,
      dispatchId: "ctx_000000000003",
      mails: [],
      worktreeRow: {
        worktreeId: "10000000-0000-4000-8000-000000000004::<path>/workspaces/sandbox/fo-orch-r3",
        liveTerminalCount: 1,
        agents: [{ state: "working" }],
      },
    });
    expect(progress.kind).toBe("active");
  });

  test("a stopped agent is ended without report", () => {
    expect(
      decideProgress({
        ...r2,
        worker: worker("worker-show-after-stop.json"),
        mails: [],
      }),
    ).toEqual({ kind: "ended-without-report", detail: "agent exited: process_stopped" });
  });

  test("a report wins over every other signal; an unknown outcome is passed on", () => {
    const progress = decideProgress({
      ...r2,
      worker: worker("worker-show-lost.json"),
      taskResult: JSON.stringify({ provenance: "worker_report", outcome: "partial", body: "b" }),
      mails: mails("escalation-lost-full.json"),
      worktreeExists: false,
    });
    expect(progress).toEqual({
      kind: "reported",
      report: { outcome: "partial", body: "b", reportedAt: null },
    });
  });

  test("a Task result that is not a worker report is not a report", () => {
    const progress = decideProgress({
      ...r2,
      worker: { ...r2.worker, liveness: "live" },
      taskResult: JSON.stringify({ provenance: "coordinator", outcome: "succeeded" }),
      mails: [],
    });
    expect(progress.kind).toBe("active");
  });
});
