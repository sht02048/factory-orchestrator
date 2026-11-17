import type { CodeHost, Runner, Tracker } from "./adapters.js";
import type { CodeHostKind, RunnerKind, TrackerKind } from "./ids.js";

/**
 * 어댑터 종류 하나를 만드는 factory. 어댑터 패키지가 하나씩 내보낸다.
 * `config`는 DB에 저장한 그 연결·러너의 설정이고, factory가 경계에서 스키마로 파싱한다.
 */
export interface AdapterFactory<K extends string, A extends { readonly kind: K }> {
  readonly kind: K;
  create(config: unknown): A;
}

export type TrackerFactory = AdapterFactory<TrackerKind, Tracker>;
export type RunnerFactory = AdapterFactory<RunnerKind, Runner>;
export type CodeHostFactory = AdapterFactory<CodeHostKind, CodeHost>;

export class UnknownAdapterKindError extends Error {
  readonly family: "tracker" | "runner" | "code-host";
  readonly adapterKind: string;

  constructor(family: "tracker" | "runner" | "code-host", adapterKind: string) {
    super(`등록하지 않은 ${family} 종류: ${adapterKind}`);
    this.name = "UnknownAdapterKindError";
    this.family = family;
    this.adapterKind = adapterKind;
  }
}

class FactoryTable<K extends string, A extends { readonly kind: K }> {
  private readonly factories = new Map<K, AdapterFactory<K, A>>();
  private readonly family: "tracker" | "runner" | "code-host";

  constructor(family: "tracker" | "runner" | "code-host") {
    this.family = family;
  }

  register(factory: AdapterFactory<K, A>): void {
    if (this.factories.has(factory.kind)) {
      throw new Error(`${this.family} 종류 ${factory.kind}를 두 번 등록했다`);
    }
    this.factories.set(factory.kind, factory);
  }

  create(kind: K, config: unknown): A {
    const factory = this.factories.get(kind);
    if (factory === undefined) throw new UnknownAdapterKindError(this.family, kind);
    const adapter = factory.create(config);
    if (adapter.kind !== kind) {
      throw new Error(`${this.family} factory ${kind}가 종류 ${adapter.kind} 어댑터를 만들었다`);
    }
    return adapter;
  }

  kinds(): K[] {
    return [...this.factories.keys()];
  }
}

/**
 * 어댑터를 등록하는 한 곳. 앱(worker·web)이 시작할 때 하나 만들고 어댑터 패키지의 factory를
 * 등록한 뒤, 저장된 Tracker Connection·Runner·코드 호스트 설정의 종류로 어댑터를 만든다.
 *
 * ```ts
 * const registry = new AdapterRegistry();
 * registry.registerTracker(linearTrackerFactory); // 새 종류는 이 한 줄을 더한다
 * const tracker = registry.createTracker(connection.kind, connection.config);
 * ```
 */
export class AdapterRegistry {
  private readonly trackers = new FactoryTable<TrackerKind, Tracker>("tracker");
  private readonly runners = new FactoryTable<RunnerKind, Runner>("runner");
  private readonly codeHosts = new FactoryTable<CodeHostKind, CodeHost>("code-host");

  registerTracker(factory: TrackerFactory): this {
    this.trackers.register(factory);
    return this;
  }

  registerRunner(factory: RunnerFactory): this {
    this.runners.register(factory);
    return this;
  }

  registerCodeHost(factory: CodeHostFactory): this {
    this.codeHosts.register(factory);
    return this;
  }

  createTracker(kind: TrackerKind, config: unknown): Tracker {
    return this.trackers.create(kind, config);
  }

  createRunner(kind: RunnerKind, config: unknown): Runner {
    return this.runners.create(kind, config);
  }

  createCodeHost(kind: CodeHostKind, config: unknown): CodeHost {
    return this.codeHosts.create(kind, config);
  }

  /** 등록한 종류. 온보딩·Settings에서 고를 목록이다. */
  kinds(): { trackers: TrackerKind[]; runners: RunnerKind[]; codeHosts: CodeHostKind[] } {
    return {
      trackers: this.trackers.kinds(),
      runners: this.runners.kinds(),
      codeHosts: this.codeHosts.kinds(),
    };
  }
}
