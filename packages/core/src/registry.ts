import type { CodeHost, Runner, Tracker } from "./adapters.js";
import type { CodeHostKind, RunnerKind, TrackerKind } from "./ids.js";

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

  kinds(): { trackers: TrackerKind[]; runners: RunnerKind[]; codeHosts: CodeHostKind[] } {
    return {
      trackers: this.trackers.kinds(),
      runners: this.runners.kinds(),
      codeHosts: this.codeHosts.kinds(),
    };
  }
}
