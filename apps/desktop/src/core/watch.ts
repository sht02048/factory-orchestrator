import type { EnsureResult, LocalServer, LocalStatus, Owner } from "./local-server.js";

/*
 * ②의 감시(티켓 0046). 앱이 열려 있는 동안 앱이 띄운 ②가 실패로 끝나면 앱이 다시 띄운다. 앱이 닫혀 있으면
 * 아무도 다시 띄우지 않는다. 24시간 지켜야 하면 launchd·systemd 가 다시 띄우는 ③을 쓴다(README).
 *
 * - 사람이 멈춘 ②(트레이 "서버 멈추기")는 다시 띄우지 않는다.
 * - ③(external)은 서비스 관리자가 다시 띄우므로 앱이 ②를 대신 띄우지 않는다. 두 벌이 잠금을 다투게 된다.
 * - 짧은 시간에 거듭 실패하면 그만 띄우고 "failed" 로 알린다. 설정이 틀린 ②를 끝없이 다시 띄우지 않는다.
 */

export type WatchState =
  | { kind: "running"; owner: Owner; status: Extract<LocalStatus, { state: "running" }> }
  | { kind: "starting"; owner: Owner }
  | { kind: "stopped"; owner: Owner | undefined }
  | { kind: "failed"; reason: string };

export interface WatchOptions {
  intervalMs?: number;
  /** windowMs 안에 이만큼 다시 띄워도 안 되면 멈춘다 */
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

  /** 사람이 켜고 끈 뜻을 적는다. 끄면 다시 띄우지 않는다. 켜면 실패 횟수를 지운다 */
  setWanted(wanted: boolean): void {
    this.wanted = wanted;
    if (!wanted) return;
    this.restarts = [];
    if (this.state.kind === "failed") this.state = { kind: "stopped", owner: this.lastOwner };
  }

  /** ensureRunning·stop 결과를 감시 상태에 반영한다 */
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

  /** 한 번 살핀다. 시험은 타이머 없이 이것을 부른다 */
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
