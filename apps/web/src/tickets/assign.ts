import {
  toAgentId,
  toRunnerId,
  toTicketKey,
  toTrackerConnectionId,
  toTrackerProjectId,
} from "@factory/core";
import { assignRun, getMapping, listRunners, listWorkspaceTrackerProjects } from "@factory/db";
import type { Database } from "@factory/db";
import { z } from "zod";

/**
 * 수동 할당 입력. 러너 쪽 프로젝트는 받지 않는다. 언제나 그 트래커 프로젝트의 Mapping 값을 쓴다(Q60).
 * runnerId 가 null 이면 할당 때 자동으로 고른다(Q53).
 */
export const assignInput = z.object({
  connection: z.string().min(1),
  ticketKey: z.string().min(1),
  trackerProject: z.string().min(1),
  runnerId: z.string().min(1).nullable(),
  agent: z.string().min(1),
});

export type AssignInput = z.infer<typeof assignInput>;

/**
 * 할당 결과.
 * - active-run: 그 티켓에 Queued·Running·Waiting for Input·Disconnected 런이 있다(Q45·Q74)
 * - no-mapping: 트래커 프로젝트에 Mapping 이 없다(Workspace 에서 뺀 트래커 프로젝트 포함)
 * - unknown-agent: Mapping 에 쓰인 에이전트가 아니다
 * - unknown-runner: 고른 러너가 없거나, 그 러너에 Mapping 의 러너 쪽 프로젝트가 없다
 * - runner-assignment-blocked: 고른 러너의 GitHub 인증이 깨졌다(Q87)
 */
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

/**
 * 운영자의 수동 할당. Mapping 기본값에서 러너와 에이전트만 바꿔 db 할당 진입점(assignRun, 0005)으로
 * Queued 런을 만든다. web 은 DB 에만 쓰고 시작은 worker 가 한다(Q61).
 */
export function submitAssignment(db: Database, input: AssignInput, now: Date): AssignResult {
  const connection = toTrackerConnectionId(input.connection);
  const trackerProject = toTrackerProjectId(input.trackerProject);
  const mapping = getMapping(db, connection, trackerProject);
  if (mapping === null) return { ok: false, reason: "no-mapping" };

  // 에이전트 목록 계약이 없어 Mapping 에 쓰인 에이전트만 받는다(load.ts mappingAgents 와 같은 출처)
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
    trackerProject,
    runnerProject: mapping.runnerProject,
    agent: toAgentId(input.agent),
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
