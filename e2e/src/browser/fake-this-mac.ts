import type {
  GangerRunnerConfig,
  MachineStep,
  StepResult,
  ThisMac,
  ThisMacStatus,
} from "@ganger/app/runner-setup/model";

export const FAKE_ORCA_PATH = "/Applications/Orca.app/Contents/Resources/bin/orca";

export class FakeThisMac implements ThisMac {
  remoteLogin = false;
  readonly ran: string[] = [];

  async status(): Promise<ThisMacStatus> {
    return {
      name: "studio-mac",
      account: "ganger",
      orcaPath: FAKE_ORCA_PATH,
      remoteLogin: this.remoteLogin,
      tailscale: "connected",
      gangerKey: true,
    };
  }

  async runStep(step: MachineStep): Promise<StepResult> {
    this.ran.push(step);
    if (step === "github") {
      return { step, outcome: "warning", problem: "gh-logged-out", detail: null };
    }
    return { step, outcome: "done", detail: null };
  }

  async runnerConfig(): Promise<{ ok: true; config: GangerRunnerConfig }> {
    this.ran.push("register");
    return {
      ok: true,
      config: {
        name: "studio-mac",
        sshTarget: "ganger@localhost",
        orcaPath: FAKE_ORCA_PATH,
        access: {
          kind: "ganger",
          identityFile: "/home/ganger/.ganger/ssh/id_ed25519",
          knownHostsFile: "/home/ganger/.ganger/ssh/known_hosts",
        },
      },
    };
  }
}

declare global {
  var __gangerE2eThisMac: FakeThisMac | undefined;
}

export function fakeThisMac(): FakeThisMac {
  globalThis.__gangerE2eThisMac ??= new FakeThisMac();
  return globalThis.__gangerE2eThisMac;
}

export function resetFakeThisMac(): FakeThisMac {
  globalThis.__gangerE2eThisMac = new FakeThisMac();
  return globalThis.__gangerE2eThisMac;
}
