import { START_PROGRESS } from "../shared/enrollment.js";
import type { EnrollmentPhase, SetupProgress } from "../shared/enrollment.js";
import type { SavedServer } from "./remote.js";
import type { AcceptResult, RunnerOffer, SetupRun } from "./runner-offer.js";

export interface EnrollmentState {
  server: string;
  offerId: string;
  step: EnrollmentPhase;
}

export interface RunnerEnrollmentDeps {
  fetchOffer: (origin: string) => Promise<RunnerOffer | null | undefined>;
  acceptOffer: (origin: string, id: string) => Promise<AcceptResult>;
  runScript: (script: string, onProgress: (progress: SetupProgress) => void) => SetupRun;
  isServerMac: (server: SavedServer) => Promise<boolean>;
  onChange: (state: EnrollmentState | null, previous: EnrollmentState | null) => void;
}

export class RunnerEnrollmentFlow {
  private readonly deps: RunnerEnrollmentDeps;
  private current: EnrollmentState | null = null;
  private origin: string | null = null;
  private run: SetupRun | null = null;
  private ticking = false;
  private readonly declined = new Set<string>();
  private readonly serverMac = new Set<string>();

  constructor(deps: RunnerEnrollmentDeps) {
    this.deps = deps;
  }

  get state(): EnrollmentState | null {
    return this.current;
  }

  get busy(): boolean {
    const step = this.current?.step;
    return step?.phase === "running" || (step?.phase === "ask" && step.accepting);
  }

  async tick(server: SavedServer | undefined): Promise<void> {
    if (this.ticking || this.busy) return;
    this.ticking = true;
    try {
      await this.look(server);
    } finally {
      this.ticking = false;
    }
  }

  private async look(server: SavedServer | undefined): Promise<void> {
    if (server === undefined) {
      const phase = this.current?.step.phase;
      if (phase === "ask" || phase === "gone") this.set(null);
      return;
    }
    if (await this.isServerMac(server)) return;
    const offer = await this.deps.fetchOffer(server.url);
    if (offer === undefined || this.busy) return;
    const current = this.current;
    const fresh = offer !== null && !this.declined.has(offer.id) ? offer : null;
    if (current === null || current.step.phase !== "ask") {
      if (fresh !== null && fresh.id !== current?.offerId) this.ask(server, fresh);
      return;
    }
    if (current.step.phase !== "ask" || offer?.id === current.offerId) return;
    if (fresh !== null) this.ask(server, fresh);
    else this.update(current, { phase: "gone", reason: "ended" });
  }

  private ask(server: SavedServer, offer: RunnerOffer): void {
    this.origin = server.url;
    this.set({ server: server.name, offerId: offer.id, step: { phase: "ask", accepting: false } });
  }

  private async isServerMac(server: SavedServer): Promise<boolean> {
    if (this.serverMac.has(server.instanceId)) return true;
    const same = await this.deps.isServerMac(server);
    if (same) this.serverMac.add(server.instanceId);
    return same;
  }

  async accept(): Promise<void> {
    const current = this.current;
    const origin = this.origin;
    if (current?.step.phase !== "ask" || current.step.accepting || origin === null) return;
    this.update(current, { phase: "ask", accepting: true });
    const result = await this.deps.acceptOffer(origin, current.offerId);
    if (!result.ok) {
      this.update(
        current,
        result.gone === null
          ? { phase: "failed", progress: { ...START_PROGRESS, problem: "server-unavailable" } }
          : { phase: "gone", reason: result.gone },
      );
      return;
    }
    this.update(current, { phase: "running", progress: START_PROGRESS, canceling: false });
    const run = this.deps.runScript(result.script, (progress) => {
      const now = this.current;
      if (now?.step.phase === "running") this.update(now, { ...now.step, progress });
    });
    this.run = run;
    const finished = await run.finished;
    this.run = null;
    this.update(
      current,
      finished.problem === null
        ? { phase: "registered", progress: finished }
        : { phase: "failed", progress: finished },
    );
  }

  cancel(): void {
    const current = this.current;
    if (current === null) return;
    const { step } = current;
    if (step.phase === "ask" && !step.accepting) {
      this.declined.add(current.offerId);
      this.set(null);
      return;
    }
    if (step.phase === "running" && !step.canceling) {
      this.update(current, { ...step, canceling: true });
      this.run?.cancel();
    }
  }

  close(): void {
    const current = this.current;
    if (current === null) return;
    const { phase } = current.step;
    if (phase === "registered" || phase === "failed" || phase === "gone") {
      this.declined.add(current.offerId);
      this.set(null);
    }
  }

  stop(): void {
    this.run?.cancel();
  }

  private update(base: EnrollmentState, step: EnrollmentPhase): void {
    this.set({ server: base.server, offerId: base.offerId, step });
  }

  private set(next: EnrollmentState | null): void {
    const previous = this.current;
    this.current = next;
    this.deps.onChange(next, previous);
  }
}
