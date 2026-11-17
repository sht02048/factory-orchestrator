import { createHash } from "node:crypto";
import type {
  AdapterRegistry,
  CodeHost,
  Runner,
  RunnerId,
  Tracker,
  TrackerConnectionId,
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
 */
export class WorkerAdapters {
  private readonly registry: AdapterRegistry;
  private readonly secretBox: SecretBox;
  private readonly runners = new Map<RunnerId, Cached<Runner>>();
  private readonly trackers = new Map<TrackerConnectionId, Cached<Tracker>>();
  private readonly codeHosts = new Map<CodeHostConnectionId, Cached<CodeHost>>();

  constructor(registry: AdapterRegistry, secretBox: SecretBox) {
    this.registry = registry;
    this.secretBox = secretBox;
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
    return reuse(this.trackers, stored.id, { kind: stored.kind, config }, () =>
      this.registry.createTracker(stored.kind, config),
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
          reuse(this.codeHosts, stored.id, { kind: stored.kind, config }, () =>
            this.registry.createCodeHost(stored.kind, config),
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
