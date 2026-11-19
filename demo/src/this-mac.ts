import type {
  GangerRunnerConfig,
  MachineStep,
  StepResult,
  ThisMac,
  ThisMacStatus,
} from "@ganger/app/runner-setup/model";

export const DEMO_ORCA_PATH = "/Applications/Orca.app/Contents/Resources/bin/orca";
const STEP_DELAY_MS = 900;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class DemoThisMac implements ThisMac {
  remoteLogin = false;
  private readonly stepDelayMs: number;

  constructor(stepDelayMs = STEP_DELAY_MS) {
    this.stepDelayMs = stepDelayMs;
  }

  toggleRemoteLogin(): boolean {
    this.remoteLogin = !this.remoteLogin;
    return this.remoteLogin;
  }

  async status(): Promise<ThisMacStatus> {
    return {
      name: "studio-mac",
      account: "ganger",
      orcaPath: DEMO_ORCA_PATH,
      remoteLogin: this.remoteLogin,
      tailscale: "connected",
      gangerKey: true,
    };
  }

  async runStep(step: MachineStep): Promise<StepResult> {
    await wait(this.stepDelayMs);
    return { step, outcome: "done", detail: step === "orca" ? DEMO_ORCA_PATH : null };
  }

  async runnerConfig(): Promise<{ ok: true; config: GangerRunnerConfig }> {
    await wait(this.stepDelayMs);
    return {
      ok: true,
      config: {
        name: "studio-mac",
        sshTarget: "ganger@localhost",
        orcaPath: DEMO_ORCA_PATH,
        access: {
          kind: "ganger",
          identityFile: "/Users/ganger/.ganger/ssh/id_ed25519",
          knownHostsFile: "/Users/ganger/.ganger/ssh/known_hosts",
        },
      },
    };
  }
}

declare global {
  var __gangerDemoThisMac: DemoThisMac | undefined;
}

export function demoThisMac(): DemoThisMac {
  globalThis.__gangerDemoThisMac ??= new DemoThisMac();
  return globalThis.__gangerDemoThisMac;
}
