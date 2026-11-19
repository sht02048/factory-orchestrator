import { RunnerEnrollments } from "@ganger/app/runner-setup/enrollment";
import type { IssuedEnrollment } from "@ganger/app/runner-setup/enrollment";
import type { GangerSsh, KeyResult, PublicKey } from "@ganger/app/runner-setup/ganger-ssh";

const DEMO_GANGER_KEY: PublicKey = {
  type: "ssh-ed25519",
  body: "AAAAC3NzaC1lZDI1NTE5AAAAIGangerDemoKey",
};

class DemoGangerSsh implements GangerSsh {
  async publicKey(): Promise<KeyResult> {
    return { ok: true, publicKey: DEMO_GANGER_KEY };
  }

  pinHostKey(): ReturnType<GangerSsh["pinHostKey"]> {
    return {
      kind: "ganger",
      identityFile: "/Users/ganger/.ganger/ssh/id_ed25519",
      knownHostsFile: "/Users/ganger/.ganger/ssh/known_hosts",
    };
  }
}

interface DemoClock {
  offsetMs: number;
}

export class DemoEnrollments extends RunnerEnrollments {
  lastToken: string | null = null;
  private readonly clock: DemoClock;

  constructor(clock: DemoClock = { offsetMs: 0 }) {
    super({ now: () => Date.now() + clock.offsetMs });
    this.clock = clock;
  }

  override issue(replacing?: string): IssuedEnrollment {
    const issued = super.issue(replacing);
    this.lastToken = issued.token;
    return issued;
  }

  expireNow(): void {
    this.clock.offsetMs += 24 * 60 * 60_000;
  }
}

interface DemoEnrollmentWorld {
  ssh: DemoGangerSsh;
  enrollments: DemoEnrollments;
}

declare global {
  var __gangerDemoEnrollment: DemoEnrollmentWorld | undefined;
}

export function demoEnrollment(): DemoEnrollmentWorld {
  globalThis.__gangerDemoEnrollment ??= {
    ssh: new DemoGangerSsh(),
    enrollments: new DemoEnrollments(),
  };
  return globalThis.__gangerDemoEnrollment;
}
