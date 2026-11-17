import { checkAutoAssignment, labelJustAttached } from "@factory/core";
import type {
  AutoAssignmentRun,
  LabelId,
  TicketRef,
  TrackerConnectionId,
  TrackerProjectId,
  TrackerTicket,
} from "@factory/core";
import {
  assignRun,
  getAutoAssignLabel,
  getMapping,
  getWorkspaceTrackerProject,
  inTransaction,
  listRuns,
  listUnprocessedTrackerEvents,
  listWorkspaces,
  markTrackerEventProcessed,
} from "@factory/db";
import type { StoredMapping, StoredRun, StoredTrackerEvent } from "@factory/db";
import type { TickContext } from "./context.js";

/** 폴링 보정 간격(ADR 0001). webhook을 놓친 할당을 이 간격으로 맞춘다. */
export const POLL_CORRECTION_INTERVAL_MS = 5 * 60_000;

/**
 * 데몬을 띄운 뒤 첫 폴링 보정이 보는 기간. webhook 이벤트는 web이 DB에 쓰므로 데몬이 꺼져 있던 동안의
 * 이벤트는 남아 있다. 이 기간은 web이 꺼져 있었거나 트래커가 webhook을 보내지 못한 경우를 맞춘다.
 */
export const POLL_CORRECTION_FIRST_LOOKBACK_MS = 24 * 60 * 60_000;

/** 앞 보정과 겹쳐 보는 시간. 트래커의 updatedAt 반영이 늦어도 빠뜨리지 않게 한다. */
const POLL_CORRECTION_OVERLAP_MS = 60_000;

/** 자동 할당 상태. 메모리에만 둔다. 다시 띄우면 첫 보정부터 다시 한다. */
export interface AutoAssignState {
  /** 다음 폴링 보정을 할 시각(epoch 밀리초) */
  nextPollAt: number;
  /** 트래커 연결 × 라벨마다 마지막으로 빠짐없이 맞춘 보정의 시작 시각(epoch 밀리초) */
  polledAt: Map<string, number>;
}

export function createAutoAssignState(): AutoAssignState {
  return { nextPollAt: 0, polledAt: new Map() };
}

/**
 * 자동 할당(스펙 3절 2번). web이 DB에 쓴 webhook 이벤트로 할당하고, 주기적으로 라벨이 붙은 티켓을 조회해
 * 놓친 할당을 맞춘다(ADR 0001). 할당은 db 할당 진입점(assignRun)으로 하고 러너는 진입점이 고른다(Q53).
 */
export async function assignAutomatically(context: TickContext): Promise<void> {
  // 자동 할당의 실패(DB 읽기 등)가 같은 바퀴의 대기열과 뒤처리를 막지 않게 여기서 멈춘다.
  try {
    processTrackerEvents(context);
    await correctByPolling(context);
  } catch (error) {
    context.logger.warn("could not assign automatically", { error });
  }
}

// ---------- webhook 이벤트 ----------

/**
 * 처리하지 않은 webhook 이벤트를 받은 순서로 본다. 할당과 처리 표시는 한 트랜잭션이라, 같은 이벤트로 런이
 * 두 번 생기지 않는다. 같은 `Linear-Delivery`는 web이 한 번만 쓴다(recordTrackerEvent). 쓰지 못한 이벤트는
 * 처리 표시가 남지 않아 다음 바퀴에 다시 본다.
 *
 * 이벤트가 쌓여 있으면(worker가 멈췄던 동안 등) 같은 티켓의 마지막 이벤트가 지금 라벨에 가장 가깝다. 그래서
 * 라벨이 방금 붙은 이벤트라도 뒤 이벤트에서 라벨이 없으면 할당하지 않는다.
 */
function processTrackerEvents(context: TickContext): void {
  const { db, now, logger } = context;
  const events = listUnprocessedTrackerEvents(db);
  const latestLabels = new Map<string, ReadonlyArray<LabelId>>();
  for (const event of events) {
    if (event.ticketKey === null || event.labelIds === null) continue;
    latestLabels.set(`${event.connection}\n${event.ticketKey}`, event.labelIds);
  }
  for (const event of events) {
    try {
      inTransaction(db, () => {
        const latest =
          event.ticketKey === null
            ? undefined
            : latestLabels.get(`${event.connection}\n${event.ticketKey}`);
        assignForEvent(context, event, latest ?? null);
        markTrackerEventProcessed(db, event.connection, event.deliveryId, now());
      });
    } catch (error) {
      logger.warn("could not process tracker event", {
        connection: event.connection,
        deliveryId: event.deliveryId,
        error,
      });
    }
  }
}

/**
 * 이벤트로 Auto-assign Label이 방금 붙었으면 할당한다(research 0005 「설계에 주는 뜻」). 라벨이 바뀌지 않은
 * 이벤트(제목만 바뀜 등)는 라벨이 남아 있어도 할당하지 않는다. 라벨을 단 채 만든 티켓은 tracker 어댑터가
 * 이전 라벨을 빈 배열로 주므로 방금 붙은 것이다(0014). 라벨이 붙은 시각은 이벤트를 받은 시각으로 본다.
 */
function assignForEvent(
  context: TickContext,
  event: StoredTrackerEvent,
  latestLabelIds: ReadonlyArray<LabelId> | null,
): void {
  if (event.kind !== "ticket.created" && event.kind !== "ticket.updated") return;
  if (event.ticketKey === null || event.projectId === null || event.labelIds === null) return;
  const target = autoAssignTarget(context, event.connection, event.projectId);
  if (target === null) return;
  if (!labelJustAttached(event, target.labelId)) return;
  if (latestLabelIds !== null && !latestLabelIds.includes(target.labelId)) return;

  const ticket: TicketRef = { connection: event.connection, key: event.ticketKey };
  const check = checkAutoAssignment({
    labelIds: event.labelIds,
    autoAssignLabelId: target.labelId,
    labelAttachedAt: event.receivedAt,
    ticket,
    runs: listRuns(context.db, { ticket }).map(toAutoAssignmentRun),
  });
  if (!check.ok) return;
  assign(context, ticket, event.projectId, target.mapping);
}

// ---------- 폴링 보정 ----------

/**
 * 폴링 보정(ADR 0001). 간격마다 Workspace의 Auto-assign Label이 붙은 티켓을 트래커에서 조회해, webhook을
 * 놓쳐 할당하지 못한 티켓을 할당한다.
 *
 * 폴링은 라벨이 언제 붙었는지 모른다. 그래서 런이 한 번도 없던 티켓만 할당한다. 런이 있던 티켓은 라벨이
 * 남아 있을 뿐인지 다시 붙었는지 가를 수 없고, 끝난 런의 티켓을 다시 할당하면 결과 댓글 등으로 티켓이
 * 갱신될 때마다 런이 새로 생긴다(Failed는 자동으로 다시 시도하지 않는다, GLOSSARY Failed). 운영자가 취소한
 * 티켓도 여기서 빠진다(Q82.12). 라벨을 다시 붙이면 webhook 경로가 할당한다.
 *
 * 조회에 실패한 트래커 연결·라벨은 보정 기간을 넘기지 않아, 다음 보정이 같은 기간부터 다시 본다.
 */
async function correctByPolling(context: TickContext): Promise<void> {
  const { autoAssign, logger } = context;
  const startedAt = context.now().getTime();
  if (startedAt < autoAssign.nextPollAt) return;
  autoAssign.nextPollAt = startedAt + POLL_CORRECTION_INTERVAL_MS;

  for (const { connection, labelId } of labelsToPoll(context)) {
    const tracker = trackerFor(context, connection);
    if (tracker === null) continue;
    const key = `${connection}\n${labelId}`;
    const since =
      (autoAssign.polledAt.get(key) ?? startedAt - POLL_CORRECTION_FIRST_LOOKBACK_MS) -
      POLL_CORRECTION_OVERLAP_MS;
    let tickets: ReadonlyArray<TrackerTicket>;
    try {
      tickets = await tracker.listLabeledTickets({ labelId, updatedSince: new Date(since) });
    } catch (error) {
      logger.warn("could not list labeled tickets", { connection, labelId, error });
      continue;
    }
    let complete = true;
    for (const ticket of tickets) {
      try {
        inTransaction(context.db, () =>
          assignForPolledTicket(context, connection, labelId, ticket),
        );
      } catch (error) {
        complete = false;
        logger.warn("could not assign a labeled ticket", {
          connection,
          ticketKey: ticket.key,
          error,
        });
      }
    }
    if (complete) autoAssign.polledAt.set(key, startedAt);
  }
}

/** 보정할 트래커 연결 × Auto-assign Label. 여러 Workspace가 같은 라벨을 쓰면 한 번만 조회한다. */
function labelsToPoll(
  context: TickContext,
): Array<{ connection: TrackerConnectionId; labelId: LabelId }> {
  const { db, logger } = context;
  let connections: TrackerConnectionId[];
  try {
    connections = context.adapters.trackerConnectionIds(db);
  } catch (error) {
    logger.warn("could not read tracker connections", { error });
    return [];
  }
  const workspaces = listWorkspaces(db);
  const seen = new Set<string>();
  const result: Array<{ connection: TrackerConnectionId; labelId: LabelId }> = [];
  for (const connection of connections) {
    for (const workspace of workspaces) {
      const labelId = getAutoAssignLabel(db, workspace.id, connection);
      if (labelId === null) continue;
      const key = `${connection}\n${labelId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ connection, labelId });
    }
  }
  return result;
}

function trackerFor(context: TickContext, connection: TrackerConnectionId) {
  try {
    return context.adapters.tracker(context.db, connection);
  } catch (error) {
    context.logger.warn("could not create tracker adapter", { connection, error });
    return null;
  }
}

/** 조회한 티켓이 그 라벨을 Auto-assign Label로 쓰는 Workspace에 속하고 런이 한 번도 없었으면 할당한다. */
function assignForPolledTicket(
  context: TickContext,
  connection: TrackerConnectionId,
  labelId: LabelId,
  ticket: TrackerTicket,
): void {
  if (ticket.project === null) return;
  const target = autoAssignTarget(context, connection, ticket.project.id);
  // 이 라벨을 쓰지 않는 Workspace의 티켓이다. 그 Workspace의 라벨로 보정할 때 본다.
  if (target === null || target.labelId !== labelId) return;

  const ref: TicketRef = { connection, key: ticket.key };
  const runs = listRuns(context.db, { ticket: ref });
  if (runs.length > 0) return;
  const check = checkAutoAssignment({
    labelIds: ticket.labels.map((label) => label.id),
    autoAssignLabelId: labelId,
    labelAttachedAt: null,
    ticket: ref,
    runs: runs.map(toAutoAssignmentRun),
  });
  if (!check.ok) return;
  assign(context, ref, ticket.project.id, target.mapping);
}

// ---------- 공통 ----------

/**
 * 트래커 프로젝트가 속한 Workspace의 Auto-assign Label과 Mapping. 어느 Workspace에도 묶이지 않았거나,
 * Workspace에 그 트래커 연결의 Auto-assign Label이 없거나, Mapping이 없으면 자동 할당하지 않는다.
 */
function autoAssignTarget(
  context: TickContext,
  connection: TrackerConnectionId,
  trackerProject: TrackerProjectId,
): { labelId: LabelId; mapping: StoredMapping } | null {
  const { db } = context;
  const project = getWorkspaceTrackerProject(db, connection, trackerProject);
  if (project === null) return null;
  const labelId = getAutoAssignLabel(db, project.workspaceId, connection);
  if (labelId === null) return null;
  const mapping = getMapping(db, connection, trackerProject);
  if (mapping === null) return null;
  return { labelId, mapping };
}

function assign(
  context: TickContext,
  ticket: TicketRef,
  trackerProject: TrackerProjectId,
  mapping: StoredMapping,
): void {
  const result = assignRun(context.db, {
    ticket,
    trackerProject,
    runnerProject: mapping.runnerProject,
    agent: mapping.agent,
    now: context.now(),
  });
  // 같은 티켓에 끝나지 않은 런이 이미 있으면(수동 할당과 엇갈림 등) 할당하지 않은 것이 맞다.
  if (!result.ok && result.reason !== "active-run") {
    context.logger.warn("could not assign ticket automatically", {
      ticketKey: ticket.key,
      reason: result.reason,
    });
  }
}

function toAutoAssignmentRun(run: StoredRun): AutoAssignmentRun {
  return {
    ticket: run.ticket,
    state: run.state,
    assignedAt: run.assignedAt,
    agentResult: run.state === "ended" ? run.agentResult : null,
    endedAt: run.state === "ended" ? run.endedAt : null,
  };
}
