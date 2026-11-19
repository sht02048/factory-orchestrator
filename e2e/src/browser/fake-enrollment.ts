import { RunnerEnrollments } from "@ganger/app/runner-setup/enrollment";
import type { GangerSsh, KeyResult, PublicKey } from "@ganger/app/runner-setup/ganger-ssh";

export const FAKE_GANGER_KEY: PublicKey = {
  type: "ssh-ed25519",
  body: "AAAAC3NzaC1lZDI1NTE5AAAAIGangerKeyForE2e",
};

export class FakeGangerSsh implements GangerSsh {
  readonly pinned = new Map<string, PublicKey>();

  async publicKey(): Promise<KeyResult> {
    return { ok: true, publicKey: FAKE_GANGER_KEY };
  }

  pinHostKey(host: string, key: PublicKey): ReturnType<GangerSsh["pinHostKey"]> {
    this.pinned.set(host, key);
    return {
      kind: "ganger",
      identityFile: "/home/ganger/.ganger/ssh/id_ed25519",
      knownHostsFile: "/home/ganger/.ganger/ssh/known_hosts",
    };
  }
}

interface FakeEnrollmentWorld {
  ssh: FakeGangerSsh;
  enrollments: RunnerEnrollments;
  clockOffsetMs: number;
}

declare global {
  var __gangerE2eEnrollment: FakeEnrollmentWorld | undefined;
}

function create(): FakeEnrollmentWorld {
  const world: FakeEnrollmentWorld = {
    ssh: new FakeGangerSsh(),
    enrollments: new RunnerEnrollments({ now: () => Date.now() + world.clockOffsetMs }),
    clockOffsetMs: 0,
  };
  return world;
}

export function fakeEnrollmentWorld(): FakeEnrollmentWorld {
  globalThis.__gangerE2eEnrollment ??= create();
  return globalThis.__gangerE2eEnrollment;
}

export function resetFakeEnrollment(): FakeEnrollmentWorld {
  globalThis.__gangerE2eEnrollment = create();
  return globalThis.__gangerE2eEnrollment;
}
