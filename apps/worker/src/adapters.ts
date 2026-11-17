import { createHash } from "node:crypto";
import { AdapterError } from "@factory/core";
import type {
  AdapterRegistry,
  CodeHost,
  CodeHostKind,
  RepoRef,
  Runner,
  RunnerId,
  RunnerProjectId,
  TicketKey,
  Tracker,
  TrackerConnectionId,
  TrackerKind,
} from "@factory/core";
import { getTrackerConnection, listCodeHostConnections, listTrackerConnections } from "@factory/db";
import type { CodeHostConnectionId, Database, SecretBox, StoredRunner } from "@factory/db";

/**
 * DB에 저장한 설정으로 어댑터를 만들고 들고 있는다. 어느 종류의 어댑터를 만들지는 저장한 종류(kind)로
 * AdapterRegistry가 정하고, worker는 트래커·러너·코드 호스트 제품을 알지 못한다.
 *
 * - 러너 factory에는 러너 설정(`config`)을 넘긴다.
 * - 트래커·코드 호스트 factory에는 `{ config, secrets }`(복호화한 비밀값 포함)를 넘긴다.
 * - 같은 대상의 종류와 설정이 그대로면 만든 어댑터를 다시 쓴다. 바뀌면 새로 만든다.
 * - 트래커·코드 호스트 연결이 인증 실패나 rate limit으로 답하면 그 연결을 잠시 쉰다(`ConnectionPause`).
 *   쉬는 동안의 호출은 요청을 보내지 않고 `ConnectionPausedError`로 바로 실패한다. 부르는 쪽은 다른 어댑터
 *   오류처럼 다음 바퀴에 다시 본다. 설정(토큰 등)을 바꾸면 어댑터를 새로 만들어 바로 풀린다.
 *   러너의 ssh 실패는 러너 확인 간격과 시작 때의 다시 해 볼 시각(worker.ts)이 늦춘다.
 */
export class WorkerAdapters {
  private readonly registry: AdapterRegistry;
  private readonly secretBox: SecretBox;
  private readonly now: () => Date;
  private readonly runners = new Map<RunnerId, Cached<Runner>>();
  private readonly trackers = new Map<TrackerConnectionId, Cached<Tracker>>();
  private readonly codeHosts = new Map<CodeHostConnectionId, Cached<CodeHost>>();

  constructor(registry: AdapterRegistry, secretBox: SecretBox, now: () => Date = () => new Date()) {
    this.registry = registry;
    this.secretBox = secretBox;
    this.now = now;
  }

  runner(stored: StoredRunner): Runner {
    return reuse(this.runners, stored.id, { kind: stored.kind, config: stored.config }, () =>
      this.registry.createRunner(stored.kind, stored.config),
    );
  }

  /** 트래커 연결이 없으면 null */
  tracker(db: Database, id: TrackerConnectionId): Tracker | null {
    const stored = getTrackerConnection(db, this.secretBox, id);
    if (stored === null) return null;
    const config = { config: stored.config, secrets: stored.secrets };
    return reuse(
      this.trackers,
      stored.id,
      { kind: stored.kind, config },
      () =>
        new PausableTracker(
          this.registry.createTracker(stored.kind, config),
          new ConnectionPause(this.now, { pauseOnUnauthorized: true }),
        ),
    );
  }

  /** 등록한 트래커 연결의 ID. 만든 순서다(폴링 보정). */
  trackerConnectionIds(db: Database): TrackerConnectionId[] {
    return listTrackerConnections(db, this.secretBox).map((stored) => stored.id);
  }

  /**
   * 등록한 코드 호스트 연결 전부. 만든 순서다. 어댑터를 만들지 못한 연결(등록하지 않은 종류,
   * 설정 오류)은 `onError`로 알리고 건너뛰어 다른 연결로 PR을 찾게 한다.
   */
  allCodeHosts(
    db: Database,
    onError: (id: CodeHostConnectionId, error: unknown) => void,
  ): CodeHost[] {
    return listCodeHostConnections(db, this.secretBox).flatMap((stored) => {
      const config = { config: stored.config, secrets: stored.secrets };
      try {
        return [
          reuse(
            this.codeHosts,
            stored.id,
            { kind: stored.kind, config },
            () =>
              new PausableCodeHost(
                this.registry.createCodeHost(stored.kind, config),
                // GitHub은 저장소 하나의 권한 부족(403, GraphQL FORBIDDEN)도 unauthorized로 낸다. 연결 전체를
                // 쉬면 같은 토큰의 다른 저장소 PR 폴링까지 멈추므로 코드 호스트는 rate limit에만 쉰다.
                new ConnectionPause(this.now, { pauseOnUnauthorized: false }),
              ),
          ),
        ];
      } catch (error) {
        onError(stored.id, error);
        return [];
      }
    });
  }
}

interface Cached<A> {
  key: string;
  adapter: A;
}

function reuse<Id extends string, A>(
  cache: Map<Id, Cached<A>>,
  id: Id,
  settings: { kind: string; config: unknown },
  create: () => A,
): A {
  // 설정에 복호화한 비밀값이 들어 있어 원문 대신 해시로 비교한다.
  const key = createHash("sha256").update(JSON.stringify(settings)).digest("hex");
  const cached = cache.get(id);
  if (cached?.key === key) return cached.adapter;
  const adapter = create();
  cache.set(id, { key, adapter });
  return adapter;
}

// ---------- 오류 종류에 맞춰 쉬기 ----------

/**
 * 인증 실패 뒤 연결을 쉬는 시간. 토큰을 고치기 전에는 몇 번을 다시 해도 실패하므로 길게 쉰다.
 * 운영자가 토큰을 바꾸면 설정이 바뀌어 어댑터를 새로 만들므로 기다리지 않고 풀린다.
 */
export const UNAUTHORIZED_PAUSE_MS = 5 * 60_000;
/** rate limit인데 다시 해 볼 시각을 모를 때 쉬는 시간 */
export const RATE_LIMIT_PAUSE_MS = 60_000;
/** 트래커·코드 호스트가 알려 준 다시 해 볼 시각이 멀어도 이보다 오래 쉬지 않는다(시계 어긋남 대비). */
export const MAX_PAUSE_MS = 60 * 60_000;

/** 연결을 쉬는 동안 요청을 보내지 않고 낸 오류. detail은 쉬게 만든 오류의 것이다. */
export class ConnectionPausedError extends AdapterError<{ kind: string }> {
  readonly until: Date;

  constructor(detail: { kind: string }, until: Date) {
    super(detail);
    this.name = "ConnectionPausedError";
    this.message = `connection paused after ${detail.kind} until ${until.toISOString()}`;
    this.until = until;
  }
}

/**
 * 연결 하나의 쉬는 상태. 어댑터와 함께 만들고 함께 버린다. 인증 실패(`unauthorized`, 연결 전체의 토큰
 * 문제일 때만 `pauseOnUnauthorized`)와 rate limit(`rate-limited`)만 쉬게 한다. 없는 대상·네트워크 오류는
 * 다음 바퀴에 그대로 다시 한다.
 */
export class ConnectionPause {
  private readonly now: () => Date;
  private readonly pauseOnUnauthorized: boolean;
  private until = 0;
  private detail: { kind: string } | null = null;

  constructor(now: () => Date, options: { pauseOnUnauthorized: boolean }) {
    this.now = now;
    this.pauseOnUnauthorized = options.pauseOnUnauthorized;
  }

  async run<T>(call: () => Promise<T>): Promise<T> {
    if (this.detail !== null && this.now().getTime() < this.until) {
      throw new ConnectionPausedError(this.detail, new Date(this.until));
    }
    try {
      return await call();
    } catch (error) {
      this.record(error);
      throw error;
    }
  }

  private record(error: unknown): void {
    if (!(error instanceof AdapterError) || error instanceof ConnectionPausedError) return;
    const detail: unknown = error.detail;
    const now = this.now().getTime();
    if (typeof detail !== "object" || detail === null || !("kind" in detail)) return;
    if (!this.pauseOnUnauthorized && detail.kind === "unauthorized") return;
    const ms = pauseMs(detail, now);
    if (ms === null) return;
    this.detail = { kind: String(detail.kind) };
    this.until = now + Math.min(Math.max(ms, 0), MAX_PAUSE_MS);
  }
}

/**
 * 어댑터 오류에 맞춰 쉴 시간. 쉬지 않으면 null이다.
 * - 트래커 rate limit은 `retryAfterSeconds`(Linear `Retry-After`, research 0002 B.4)를 따른다.
 * - 코드 호스트 rate limit은 `resetAt`(GitHub `x-ratelimit-reset`, research 0006 18절)을 따른다.
 */
export function pauseMs(detail: unknown, now: number): number | null {
  if (typeof detail !== "object" || detail === null || !("kind" in detail)) return null;
  if (detail.kind === "unauthorized") return UNAUTHORIZED_PAUSE_MS;
  if (detail.kind !== "rate-limited") return null;
  if ("retryAfterSeconds" in detail && typeof detail.retryAfterSeconds === "number") {
    return detail.retryAfterSeconds * 1000;
  }
  if ("resetAt" in detail && detail.resetAt instanceof Date) {
    return detail.resetAt.getTime() - now;
  }
  return RATE_LIMIT_PAUSE_MS;
}

/** 요청을 보내는 메서드를 쉬는 상태로 감싼 트래커. webhook 확인과 연결 확인은 그대로 넘긴다. */
class PausableTracker implements Tracker {
  readonly kind: TrackerKind;
  private readonly inner: Tracker;
  private readonly pause: ConnectionPause;

  constructor(inner: Tracker, pause: ConnectionPause) {
    this.kind = inner.kind;
    this.inner = inner;
    this.pause = pause;
  }

  checkConnection(): ReturnType<Tracker["checkConnection"]> {
    return this.inner.checkConnection();
  }

  verifyWebhook(
    input: Parameters<Tracker["verifyWebhook"]>[0],
  ): ReturnType<Tracker["verifyWebhook"]> {
    return this.inner.verifyWebhook(input);
  }

  getTicket(key: TicketKey): ReturnType<Tracker["getTicket"]> {
    return this.pause.run(() => this.inner.getTicket(key));
  }

  listProjectTickets(
    ...args: Parameters<Tracker["listProjectTickets"]>
  ): ReturnType<Tracker["listProjectTickets"]> {
    return this.pause.run(() => this.inner.listProjectTickets(...args));
  }

  listLabeledTickets(
    ...args: Parameters<Tracker["listLabeledTickets"]>
  ): ReturnType<Tracker["listLabeledTickets"]> {
    return this.pause.run(() => this.inner.listLabeledTickets(...args));
  }

  listComments(...args: Parameters<Tracker["listComments"]>): ReturnType<Tracker["listComments"]> {
    return this.pause.run(() => this.inner.listComments(...args));
  }

  listProjects(): ReturnType<Tracker["listProjects"]> {
    return this.pause.run(() => this.inner.listProjects());
  }

  listLabels(...args: Parameters<Tracker["listLabels"]>): ReturnType<Tracker["listLabels"]> {
    return this.pause.run(() => this.inner.listLabels(...args));
  }

  listStates(...args: Parameters<Tracker["listStates"]>): ReturnType<Tracker["listStates"]> {
    return this.pause.run(() => this.inner.listStates(...args));
  }

  setState(...args: Parameters<Tracker["setState"]>): ReturnType<Tracker["setState"]> {
    return this.pause.run(() => this.inner.setState(...args));
  }

  addComment(...args: Parameters<Tracker["addComment"]>): ReturnType<Tracker["addComment"]> {
    return this.pause.run(() => this.inner.addComment(...args));
  }
}

/** 요청을 보내는 메서드를 쉬는 상태로 감싼 코드 호스트. 저장소 읽기와 연결 확인은 그대로 넘긴다. */
class PausableCodeHost implements CodeHost {
  readonly kind: CodeHostKind;
  private readonly inner: CodeHost;
  private readonly pause: ConnectionPause;

  constructor(inner: CodeHost, pause: ConnectionPause) {
    this.kind = inner.kind;
    this.inner = inner;
    this.pause = pause;
  }

  checkConnection(): ReturnType<CodeHost["checkConnection"]> {
    return this.inner.checkConnection();
  }

  repoOf(project: RunnerProjectId): RepoRef | null {
    return this.inner.repoOf(project);
  }

  findPullRequestsByBranch(
    ...args: Parameters<CodeHost["findPullRequestsByBranch"]>
  ): ReturnType<CodeHost["findPullRequestsByBranch"]> {
    return this.pause.run(() => this.inner.findPullRequestsByBranch(...args));
  }

  findPullRequestsByTicketKey(
    ...args: Parameters<CodeHost["findPullRequestsByTicketKey"]>
  ): ReturnType<CodeHost["findPullRequestsByTicketKey"]> {
    return this.pause.run(() => this.inner.findPullRequestsByTicketKey(...args));
  }

  getPullRequest(
    ...args: Parameters<CodeHost["getPullRequest"]>
  ): ReturnType<CodeHost["getPullRequest"]> {
    return this.pause.run(() => this.inner.getPullRequest(...args));
  }

  rateLimit(): ReturnType<CodeHost["rateLimit"]> {
    return this.pause.run(() => this.inner.rateLimit());
  }
}
