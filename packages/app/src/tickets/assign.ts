import {
  toAgentId,
  toRunnerId,
  toTicketKey,
  toTrackerConnectionId,
  toTrackerProjectId,
} from "@ganger/core";
import {
  TICKET_TITLE_MAX_LENGTH,
  assignRun,
  getMapping,
  listRunners,
  listWorkspaceTrackerProjects,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import { z } from "zod";

export const assignInput = z.object({
  connection: z.string().min(1),
  ticketKey: z.string().min(1),
  ticketTitle: z.string().trim().max(TICKET_TITLE_MAX_LENGTH).default(""),
  trackerProject: z.string().min(1),
  runnerId: z.string().min(1).nullable(),
  agent: z.string().min(1),
});

export type AssignInput = z.infer<typeof assignInput>;

export type AssignResult =
  | { ok: true; runId: string }
  | {
      ok: false;
      reason:
        | "active-run"
        | "no-mapping"
        | "unknown-agent"
        | "unknown-runner"
        | "runner-assignment-blocked";
    };

export function submitAssignment(db: Database, input: AssignInput, now: Date): AssignResult {
  const connection = toTrackerConnectionId(input.connection);
  const trackerProject = toTrackerProjectId(input.trackerProject);
  const mapping = getMapping(db, connection, trackerProject);
  if (mapping === null) return { ok: false, reason: "no-mapping" };

  const knownAgent =
    input.agent === mapping.agent ||
    listWorkspaceTrackerProjects(db).some(
      (project) => getMapping(db, project.connection, project.projectId)?.agent === input.agent,
    );
  if (!knownAgent) return { ok: false, reason: "unknown-agent" };

  if (input.runnerId !== null) {
    const runner = listRunners(db).find((r) => r.id === input.runnerId);
    if (runner === undefined || !runner.projects.some((p) => p.id === mapping.runnerProject)) {
      return { ok: false, reason: "unknown-runner" };
    }
  }

  const result = assignRun(db, {
    ticket: { connection, key: toTicketKey(input.ticketKey) },
    ticketTitle: input.ticketTitle,
    trackerProject,
    runnerProject: mapping.runnerProject,
    agent: toAgentId(input.agent),
    model: input.agent === mapping.agent ? mapping.model : null,
    ...(input.runnerId === null ? {} : { runnerId: toRunnerId(input.runnerId) }),
    now,
  });
  if (result.ok) return { ok: true, runId: result.run.id };
  switch (result.reason) {
    case "active-run":
    case "unknown-runner":
    case "runner-assignment-blocked":
      return { ok: false, reason: result.reason };
    case "unknown-tracker-project":
      return { ok: false, reason: "no-mapping" };
  }
}
