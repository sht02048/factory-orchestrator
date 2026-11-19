export const ENROLLMENT_PATH = "/api/runner-enrollment";
export const SETUP_SCRIPT_PATH = `${ENROLLMENT_PATH}/script`;
export const ENROLLMENT_OFFER_PATH = `${ENROLLMENT_PATH}/offer`;
export const ENROLLMENT_ACCEPT_PATH = `${ENROLLMENT_OFFER_PATH}/accept`;

export const ENROLLMENT_PROBLEMS = [
  "remote-login-off",
  "orca-not-found",
  "tailscale-missing",
  "host-key-missing",
  "authorized-keys-failed",
  "service-failed",
  "invalid-report",
  "register-failed",
  "canceled",
] as const;
export type EnrollmentProblem = (typeof ENROLLMENT_PROBLEMS)[number];

export const REPORTED_PROBLEMS = ENROLLMENT_PROBLEMS.filter(
  (problem) => problem !== "invalid-report" && problem !== "register-failed",
);

export const GITHUB_SETUP_RESULTS = ["done", "gh-missing", "gh-logged-out", "gh-failed"] as const;
export type GitHubSetupResult = (typeof GITHUB_SETUP_RESULTS)[number];

export const PROGRESS_ENV = "GANGER_PROGRESS";
export const PROGRESS_STEP_PREFIX = "ganger-step:";
export const PROGRESS_FAIL_PREFIX = "ganger-fail:";
export const PROGRESS_GITHUB_PREFIX = "ganger-github:";
export const SETUP_PROGRESS_STEPS = [
  "remote-login-wait",
  "remote-login",
  "key",
  "service",
  "github",
  "report",
] as const;
export type SetupProgressStep = (typeof SETUP_PROGRESS_STEPS)[number];
export const SETUP_LOCAL_FAILURES = ["refused", "unreachable"] as const;
