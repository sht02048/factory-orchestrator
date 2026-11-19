export const THIS_MAC_STEPS = ["key", "hostKey", "orca", "service", "github", "register"] as const;
export type ThisMacStep = (typeof THIS_MAC_STEPS)[number];
export type MachineStep = Exclude<ThisMacStep, "register">;

export const STEP_PROBLEMS = [
  "no-home",
  "remote-login-off",
  "keygen-failed",
  "authorized-keys-failed",
  "host-key-missing",
  "known-hosts-failed",
  "orca-not-found",
  "service-failed",
  "gh-missing",
  "gh-logged-out",
  "gh-failed",
  "register-failed",
] as const;
export type StepProblem = (typeof STEP_PROBLEMS)[number];

export type StepResult =
  | { step: ThisMacStep; outcome: "done"; detail: string | null }
  | {
      step: ThisMacStep;
      outcome: "warning" | "failed";
      problem: StepProblem;
      detail: string | null;
    };

export type TailscaleState = "connected" | "disconnected" | "missing";

export interface ThisMacStatus {
  name: string;
  account: string;
  orcaPath: string | null;
  remoteLogin: boolean;
  tailscale: TailscaleState;
  gangerKey: boolean;
}

export interface GangerRunnerConfig {
  name: string;
  sshTarget: string;
  orcaPath: string;
  access: { kind: "ganger"; identityFile: string; knownHostsFile: string };
}

export interface ThisMac {
  status(): Promise<ThisMacStatus>;
  runStep(step: MachineStep): Promise<StepResult>;
  runnerConfig(): Promise<
    { ok: true; config: GangerRunnerConfig } | { ok: false; result: StepResult }
  >;
}

export const SHARING_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.preferences.sharing?Services_RemoteLogin";
