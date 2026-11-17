import {
  toCommentId,
  toLabelId,
  toTicketKey,
  toTrackerKind,
  toTrackerProjectId,
  toTrackerStateId,
} from "@factory/core";
import type {
  CommentId,
  ConnectionCheck,
  LabelId,
  Page,
  Paged,
  TicketKey,
  Tracker,
  TrackerComment,
  TrackerErrorDetail,
  TrackerFactory,
  TrackerLabel,
  TrackerProject,
  TrackerProjectId,
  TrackerState,
  TrackerStateId,
  TrackerTicket,
} from "@factory/core";
import { z } from "zod";
import { LinearClient, LinearTrackerError, connectionSchema } from "./client.js";
import type { Fetch } from "./client.js";
import { verifyLinearWebhook } from "./webhook.js";
import type { WebhookResult } from "./webhook.js";

export const LINEAR_TRACKER_KIND = toTrackerKind("linear");

/** `first` 상한(research 0005 12절). 넘으면 Linear가 INVALID_INPUT 오류를 낸다. */
export const LINEAR_MAX_PAGE_SIZE = 250;
/** `first`를 주지 않았을 때. Linear 기본값과 같다(research 0002 B.3). */
const DEFAULT_PAGE_SIZE = 50;
/**
 * 티켓 하나에서 읽는 라벨 수. 목록 쿼리 복잡도가 실제로 돌려준 노드 수로 매겨져(research 0005 12절,
 * 이 티켓에서 `issues(first: 250) { labels(first: 250) }`의 `x-complexity`가 5) 넉넉히 잡는다.
 */
const LABELS_PER_TICKET = 100;
/** 전부 읽는 목록이 끝나지 않을 때 멈추는 쪽수. 250 × 200 = 5만 건이다. */
const MAX_PAGES = 200;

/**
 * DB에 저장한 Tracker Connection 설정. worker·web이 factory에 `{ config, secrets }`로 넘긴다
 * (apps/worker `WorkerAdapters`).
 */
export const linearConnectionSettingsSchema = z.object({
  config: z
    .object({
      /** 테스트용. 없으면 https://api.linear.app/graphql */
      apiUrl: z.url().optional(),
    })
    .loose()
    .nullish(),
  secrets: z.object({
    /** 개인 API 키(research 0002 B.1) */
    apiKey: z.string().min(1),
    /** webhook signing secret. webhook을 아직 만들지 않았으면 없다 */
    webhookSecret: z.string().min(1).nullish(),
  }),
});

export type LinearConnectionSettings = z.input<typeof linearConnectionSettingsSchema>;

export const linearTrackerFactory: TrackerFactory = {
  kind: LINEAR_TRACKER_KIND,
  create(config: unknown): Tracker {
    const settings = linearConnectionSettingsSchema.parse(config);
    const apiUrl = settings.config?.apiUrl;
    return new LinearTracker({
      apiKey: settings.secrets.apiKey,
      webhookSecret: settings.secrets.webhookSecret ?? null,
      ...(apiUrl === undefined ? {} : { apiUrl }),
    });
  },
};

// ---------- GraphQL ----------

const TICKET_FIELDS = `
fragment TicketFields on Issue {
  identifier
  title
  description
  url
  updatedAt
  state { id name type }
  project { id name }
  labels(first: ${LABELS_PER_TICKET}) { nodes { id name } }
}`;

const PAGE_INFO = "pageInfo { hasNextPage endCursor }";

const QUERY_CONNECTION = "query Connection { viewer { id } }";

const QUERY_TICKET = `query Ticket($id: String!) { issue(id: $id) { ...TicketFields } }
${TICKET_FIELDS}`;

const QUERY_PROJECT_TICKETS = `query ProjectTickets($projectId: ID!, $first: Int!, $after: String) {
  issues(filter: { project: { id: { eq: $projectId } } }, first: $first, after: $after) {
    nodes { ...TicketFields }
    ${PAGE_INFO}
  }
}
${TICKET_FIELDS}`;

const QUERY_LABELED_TICKETS = `query LabeledTickets($labelId: ID!, $updatedSince: DateTimeOrDuration!, $first: Int!, $after: String) {
  issues(filter: { labels: { id: { eq: $labelId } }, updatedAt: { gte: $updatedSince } }, first: $first, after: $after) {
    nodes { ...TicketFields }
    ${PAGE_INFO}
  }
}
${TICKET_FIELDS}`;

const QUERY_COMMENTS = `query TicketComments($id: String!, $first: Int!, $after: String) {
  issue(id: $id) {
    comments(first: $first, after: $after) {
      nodes { id body createdAt user { name } }
      ${PAGE_INFO}
    }
  }
}`;

const QUERY_PROJECTS = `query Projects($first: Int!, $after: String) {
  projects(first: $first, after: $after) {
    nodes { id name url }
    ${PAGE_INFO}
  }
}`;

const QUERY_PROJECT_TEAMS = `query ProjectTeams($id: String!) {
  project(id: $id) { teams(first: ${LINEAR_MAX_PAGE_SIZE}) { nodes { id } } }
}`;

const QUERY_TEAM_STATES = `query TeamStates($teamIds: [ID!]!, $first: Int!, $after: String) {
  workflowStates(filter: { team: { id: { in: $teamIds } } }, first: $first, after: $after) {
    nodes { id name type position }
    ${PAGE_INFO}
  }
}`;

const QUERY_TEAM_LABELS = `query TeamLabels($teamIds: [ID!]!, $first: Int!, $after: String) {
  issueLabels(filter: { or: [{ team: { id: { in: $teamIds } } }, { team: { null: true } }] }, first: $first, after: $after) {
    nodes { id name isGroup }
    ${PAGE_INFO}
  }
}`;

const MUTATION_SET_STATE = `mutation SetState($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) { success }
}`;

const MUTATION_ADD_COMMENT = `mutation AddComment($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId, body: $body }) { success comment { id url } }
}`;

// ---------- 응답 스키마 ----------

const idSchema = z.string().min(1);
const dateSchema = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

const stateSchema = z.object({ id: idSchema, name: z.string(), type: z.string() });

const ticketSchema = z
  .object({
    identifier: idSchema,
    title: z.string(),
    description: z.string().nullable(),
    url: z.string(),
    updatedAt: dateSchema,
    state: stateSchema,
    project: z.object({ id: idSchema, name: z.string() }).nullable(),
    labels: z.object({ nodes: z.array(z.object({ id: idSchema, name: z.string() })) }),
  })
  .transform((issue): TrackerTicket => ({
    key: toTicketKey(issue.identifier),
    title: issue.title,
    body: issue.description ?? "",
    url: issue.url,
    labels: issue.labels.nodes.map(toLabel),
    project:
      issue.project === null
        ? null
        : { id: toTrackerProjectId(issue.project.id), name: issue.project.name },
    state: toState(issue.state),
    updatedAt: issue.updatedAt,
  }));

const ticketConnectionSchema = z.object({ issues: connectionSchema(ticketSchema) });

const commentSchema = z
  .object({
    id: idSchema,
    body: z.string(),
    createdAt: dateSchema,
    user: z.object({ name: z.string() }).nullable(),
  })
  .transform((comment): TrackerComment => ({
    id: toCommentId(comment.id),
    body: comment.body,
    createdAt: comment.createdAt,
    author: comment.user?.name ?? null,
  }));

const projectSchema = z
  .object({ id: idSchema, name: z.string(), url: z.string() })
  .transform((project): TrackerProject => ({
    id: toTrackerProjectId(project.id),
    name: project.name,
    url: project.url,
  }));

const workflowStateSchema = stateSchema.extend({ position: z.number() });
const issueLabelSchema = z.object({ id: idSchema, name: z.string(), isGroup: z.boolean() });

function toLabel(label: { id: string; name: string }): TrackerLabel {
  return { id: toLabelId(label.id), name: label.name };
}

/** Linear 상태 `type`이 곧 core 상태 분류다. 모르는 값(`duplicate` 등)은 그대로 둔다. */
function toState(state: { id: string; name: string; type: string }): TrackerState {
  return { id: toTrackerStateId(state.id), name: state.name, category: state.type };
}

/** 상태 고르기 화면에서 워크플로 순서대로 보이게 하는 분류 순서 */
const CATEGORY_ORDER = ["triage", "backlog", "unstarted", "started", "completed", "canceled"];

function categoryRank(category: string): number {
  const index = CATEGORY_ORDER.indexOf(category);
  return index === -1 ? CATEGORY_ORDER.length : index;
}

function pageSize(page: Page | undefined): number {
  const first = page?.first ?? DEFAULT_PAGE_SIZE;
  if (!Number.isFinite(first)) return DEFAULT_PAGE_SIZE;
  return Math.min(LINEAR_MAX_PAGE_SIZE, Math.max(1, Math.trunc(first)));
}

function notFound(): LinearTrackerError {
  return new LinearTrackerError({ kind: "not-found" });
}

// ---------- 어댑터 ----------

/**
 * Linear 트래커 어댑터. 티켓 키는 Linear identifier(예: ENG-123)이고, Linear는 GraphQL `issue(id:)`와
 * mutation의 `id`·`issueId`에 identifier를 그대로 받는다(이 티켓에서 확인).
 */
export class LinearTracker implements Tracker {
  readonly kind = LINEAR_TRACKER_KIND;
  private readonly client: LinearClient;
  private readonly webhookSecret: string | null;

  constructor(input: {
    apiKey: string;
    webhookSecret: string | null;
    apiUrl?: string;
    fetch?: Fetch;
  }) {
    this.client = new LinearClient(input);
    this.webhookSecret = input.webhookSecret;
  }

  async checkConnection(): Promise<ConnectionCheck<TrackerErrorDetail>> {
    try {
      await this.client.request(
        QUERY_CONNECTION,
        {},
        z.object({ viewer: z.object({ id: idSchema }) }),
      );
      return { ok: true };
    } catch (error) {
      if (error instanceof LinearTrackerError) return { ok: false, error: error.detail };
      throw error;
    }
  }

  verifyWebhook(input: {
    rawBody: Uint8Array;
    headers: Readonly<Record<string, string | undefined>>;
    now: Date;
  }): WebhookResult {
    return verifyLinearWebhook({ ...input, secret: this.webhookSecret });
  }

  async getTicket(key: TicketKey): Promise<TrackerTicket | null> {
    try {
      const data = await this.client.request(
        QUERY_TICKET,
        { id: key },
        z.object({ issue: ticketSchema }),
      );
      return data.issue;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async listProjectTickets(
    projectId: TrackerProjectId,
    page?: Page,
  ): Promise<Paged<TrackerTicket>> {
    const data = await this.client.request(
      QUERY_PROJECT_TICKETS,
      { projectId, first: pageSize(page), after: page?.after ?? null },
      ticketConnectionSchema,
    );
    return toPaged(data.issues);
  }

  async listLabeledTickets(input: {
    labelId: LabelId;
    updatedSince: Date;
  }): Promise<ReadonlyArray<TrackerTicket>> {
    return this.readAll(
      QUERY_LABELED_TICKETS,
      {
        labelId: input.labelId,
        updatedSince: input.updatedSince.toISOString(),
      },
      ticketConnectionSchema.transform((data) => data.issues),
    );
  }

  async listComments(key: TicketKey, page?: Page): Promise<Paged<TrackerComment>> {
    const data = await this.client.request(
      QUERY_COMMENTS,
      { id: key, first: pageSize(page), after: page?.after ?? null },
      z.object({ issue: z.object({ comments: connectionSchema(commentSchema) }) }),
    );
    return toPaged(data.issue.comments);
  }

  async listProjects(): Promise<ReadonlyArray<TrackerProject>> {
    return this.readAll(
      QUERY_PROJECTS,
      {},
      z.object({ projects: connectionSchema(projectSchema) }).transform((data) => data.projects),
    );
  }

  async listLabels(projectId: TrackerProjectId): Promise<ReadonlyArray<TrackerLabel>> {
    const teamIds = await this.projectTeamIds(projectId);
    const labels = await this.readAll(
      QUERY_TEAM_LABELS,
      { teamIds },
      z
        .object({ issueLabels: connectionSchema(issueLabelSchema) })
        .transform((data) => data.issueLabels),
    );
    // 그룹 라벨은 티켓에 직접 붙지 않는다.
    return labels
      .filter((label) => !label.isGroup)
      .map(toLabel)
      .toSorted((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Linear 상태는 팀마다 다르다(research 0002 B). 트래커 프로젝트가 속한 팀들의 상태를 모아 워크플로
   * 순서로 돌려준다. 팀이 여럿이면 이름이 같은 상태가 팀마다 하나씩 있다.
   */
  async listStates(projectId: TrackerProjectId): Promise<ReadonlyArray<TrackerState>> {
    const teamIds = await this.projectTeamIds(projectId);
    const states = await this.readAll(
      QUERY_TEAM_STATES,
      { teamIds },
      z
        .object({ workflowStates: connectionSchema(workflowStateSchema) })
        .transform((data) => data.workflowStates),
    );
    return states
      .toSorted((a, b) => categoryRank(a.type) - categoryRank(b.type) || a.position - b.position)
      .map(toState);
  }

  async setState(key: TicketKey, stateId: TrackerStateId): Promise<void> {
    const data = await this.client.request(
      MUTATION_SET_STATE,
      { id: key, stateId },
      z.object({ issueUpdate: z.object({ success: z.boolean() }) }),
    );
    if (!data.issueUpdate.success) throw notFound();
  }

  async addComment(key: TicketKey, body: string): Promise<{ id: CommentId; url: string }> {
    const data = await this.client.request(
      MUTATION_ADD_COMMENT,
      { issueId: key, body },
      z.object({
        commentCreate: z.object({
          success: z.boolean(),
          comment: z.object({ id: idSchema, url: z.string() }).nullable(),
        }),
      }),
    );
    const comment = data.commentCreate.comment;
    if (!data.commentCreate.success || comment === null) throw notFound();
    return { id: toCommentId(comment.id), url: comment.url };
  }

  private async projectTeamIds(projectId: TrackerProjectId): Promise<string[]> {
    const data = await this.client.request(
      QUERY_PROJECT_TEAMS,
      { id: projectId },
      z.object({
        project: z.object({ teams: z.object({ nodes: z.array(z.object({ id: idSchema })) }) }),
      }),
    );
    return data.project.teams.nodes.map((team) => team.id);
  }

  /** 모든 쪽을 `first` 상한으로 읽는다. */
  private async readAll<T>(
    query: string,
    variables: Readonly<Record<string, unknown>>,
    schema: z.ZodType<{
      nodes: T[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    }>,
  ): Promise<T[]> {
    type Connection = { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
    const items: T[] = [];
    let after: string | null = null;
    for (let pages = 0; pages < MAX_PAGES; pages += 1) {
      const data: Connection = await this.client.request(
        query,
        { ...variables, first: LINEAR_MAX_PAGE_SIZE, after },
        schema,
      );
      items.push(...data.nodes);
      if (!data.pageInfo.hasNextPage || data.pageInfo.endCursor === null) return items;
      after = data.pageInfo.endCursor;
    }
    throw new Error(`Linear 목록이 ${MAX_PAGES}쪽을 넘었다`);
  }
}

function toPaged<T>(connection: {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}): Paged<T> {
  return {
    items: connection.nodes,
    nextCursor: connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null,
  };
}

function isNotFound(error: unknown): boolean {
  return error instanceof LinearTrackerError && error.detail.kind === "not-found";
}
