import {
  REPORTED_PROBLEMS,
  SETUP_LOCAL_FAILURES,
} from "@ganger/app/runner-setup/enrollment-protocol";
import type { GitHubSetupResult } from "@ganger/app/runner-setup/enrollment-protocol";

export const OFFER_GONE = ["taken", "expired", "unknown"] as const;
export type OfferGone = (typeof OFFER_GONE)[number];
export type EnrollmentGone = OfferGone | "ended";

export const SETUP_PROBLEMS = [
  ...REPORTED_PROBLEMS,
  ...SETUP_LOCAL_FAILURES,
  "server-unavailable",
  "script-failed",
] as const;
export type SetupProblem = (typeof SETUP_PROBLEMS)[number];

export const ENROLL_STEPS = ["remoteLogin", "key", "service", "github", "register"] as const;
export type EnrollStep = (typeof ENROLL_STEPS)[number];

export interface SetupProgress {
  done: ReadonlyArray<EnrollStep>;
  waitingForRemoteLogin: boolean;
  github: GitHubSetupResult | null;
  problem: SetupProblem | null;
}

export const START_PROGRESS: SetupProgress = {
  done: [],
  waitingForRemoteLogin: false,
  github: null,
  problem: null,
};

export type EnrollmentPhase =
  | { phase: "ask"; accepting: boolean }
  | { phase: "running"; progress: SetupProgress; canceling: boolean }
  | { phase: "registered"; progress: SetupProgress }
  | { phase: "failed"; progress: SetupProgress }
  | { phase: "gone"; reason: EnrollmentGone };
