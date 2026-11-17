import type {
  AdapterRegistry,
  CodeHost,
  Runner,
  Tracker,
  TrackerConnectionId,
} from "@factory/core";
import { getTrackerConnection, listCodeHostConnections } from "@factory/db";
import type { Database, SecretBox, StoredRunner } from "@factory/db";

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
  private readonly runners = new Map<string, Cached<Runner>>();
  private readonly trackers = new Map<string, Cached<Tracker>>();
  private readonly codeHosts = new Map<string, Cached<CodeHost>>();

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

  /** 등록한 코드 호스트 연결 전부. 만든 순서다. */
  allCodeHosts(db: Database): CodeHost[] {
    return listCodeHostConnections(db, this.secretBox).map((stored) => {
      const config = { config: stored.config, secrets: stored.secrets };
      return reuse(this.codeHosts, stored.id, { kind: stored.kind, config }, () =>
        this.registry.createCodeHost(stored.kind, config),
      );
    });
  }
}

interface Cached<A> {
  key: string;
  adapter: A;
}

function reuse<A>(
  cache: Map<string, Cached<A>>,
  id: string,
  settings: { kind: string; config: unknown },
  create: () => A,
): A {
  const key = JSON.stringify(settings);
  const cached = cache.get(id);
  if (cached?.key === key) return cached.adapter;
  const adapter = create();
  cache.set(id, { key, adapter });
  return adapter;
}
