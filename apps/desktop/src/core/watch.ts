import type { EnsureResult, LocalServer, LocalStatus, Owner } from "./local-server.js";

export type WatchState =
  | { kind: "running"; owner: Owner; status: Extract<LocalStatus, { state: "running" }> }
  | { kind: "starting"; owner: Owner }
  | { kind: "stopped"; owner: Owner | undefined }
  | { kind: "failed"; reason: string };

export interface WatchOptions {
  intervalMs?: number;
  maxRestarts?: number;
  windowMs?: number;
  now?: () => number;
  onChange?: (state: WatchState) => void;
}

export class ServerWatch {
  private readonly server: LocalServer;
  private readonly options: Required<Omit<WatchOptions, "onChange">> & {
    onChange: ((state: WatchState) => void) | undefined;
  };
  private timer: NodeJS.Timeout | undefined;
  private wanted = true;
  private lastOwner: Owner | undefined;
  private restarts: number[] = [];
  private ticking: Promise<void> | undefined;
  state: WatchState = { kind: "stopped", owner: undefined };

  constructor(server: LocalServer, options: WatchOptions = {}) {
    this.server = server;
    this.options = {
      intervalMs: options.intervalMs ?? 5_000,
      maxRestarts: options.maxRestarts ?? 3,
      windowMs: options.windowMs ?? 120_000,
      now: options.now ?? Date.now,
      onChange: options.onChange,
    };
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => void this.tick(), this.options.intervalMs);
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  setWanted(wanted: boolean): void {
    this.wanted = wanted;
    if (!wanted) return;
    this.restarts = [];
    if (this.state.kind === "failed") this.state = { kind: "stopped", owner: this.lastOwner };
  }

  adopt(result: EnsureResult): void {
    switch (result.kind) {
      case "running":
        this.lastOwner = result.status.owner;
        this.report({ kind: "running", owner: result.status.owner, status: result.status });
        return;
      case "service-not-running":
        this.lastOwner = "external";
        this.report({ kind: "stopped", owner: "external" });
        return;
      case "failed":
        this.report({ kind: "failed", reason: result.reason });
        return;
    }
  }

  tick(): Promise<void> {
    this.ticking ??= this.check().finally(() => (this.ticking = undefined));
    return this.ticking;
  }

  private async check(): Promise<void> {
    const status = await this.server.status();
    if (status.state === "running") {
      this.lastOwner = status.owner;
      this.report({ kind: "running", owner: status.owner, status });
      return;
    }
    if (status.state === "starting") {
      this.lastOwner = status.owner;
      this.report({ kind: "starting", owner: status.owner });
      return;
    }
    if (!this.wanted || this.lastOwner !== "app" || this.state.kind === "failed") {
      if (this.state.kind !== "failed") this.report({ kind: "stopped", owner: this.lastOwner });
      return;
    }
    const now = this.options.now();
    this.restarts = this.restarts.filter((at) => now - at < this.options.windowMs);
    if (this.restarts.length >= this.options.maxRestarts) {
      this.report({ kind: "failed", reason: "the server kept exiting" });
      return;
    }
    this.restarts.push(now);
    this.report({ kind: "starting", owner: "app" });
    this.adopt(await this.server.ensureRunning());
  }

  private report(state: WatchState): void {
    this.state = state;
    this.options.onChange?.(state);
  }
}
